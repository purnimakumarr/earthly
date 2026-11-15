const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const mongoose = require('mongoose');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');

const config = require('./config');
const logger = require('./config/logger');
const ApiError = require('./utils/ApiError');
const errorHandler = require('./middleware/errorHandler');
const { UPLOAD_ROOT } = require('./middleware/upload');
const apiRouter = require('./routes');
const { razorpayWebhook } = require('./controllers/booking.controller');

const CLIENT_DIST = path.join(__dirname, '../client/dist');
const OPENAPI_FILE = path.join(__dirname, '../docs/openapi.yaml');

const app = express();

// One proxy hop (the host's load balancer): needed for req.ip and secure cookies.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://tile.openstreetmap.org',
          'https://*.razorpay.com',
        ],
        connectSrc: ["'self'", 'https://*.razorpay.com'],
        frameSrc: ['https://*.razorpay.com'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
      },
    },
    // OpenStreetMap tile servers reject requests that carry no Referer.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);

app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => !req.url.startsWith('/api') },
  }),
);

app.get('/healthz', (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded', db: dbUp });
});

app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.isTest,
    message: { status: 'fail', message: 'Too many requests. Try again later.' },
  }),
);

// Raw body on purpose: the webhook signature is an HMAC of the exact bytes.
app.post(
  '/api/v1/webhooks/razorpay',
  express.raw({ type: 'application/json', limit: '100kb' }),
  razorpayWebhook,
);

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Strip `$` and `.` keys so request data cannot smuggle in query operators.
app.use(mongoSanitize());

// Collapse repeated query parameters, except where a list makes sense.
app.use(
  hpp({
    whitelist: [
      'difficulty',
      'region',
      'duration',
      'maxGroupSize',
      'price',
      'ratingsAverage',
    ],
  }),
);

app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: '7d', index: false }));

if (fs.existsSync(OPENAPI_FILE)) {
  const spec = YAML.parse(fs.readFileSync(OPENAPI_FILE, 'utf8'));
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, { customSiteTitle: 'Earthly API' }),
  );
}

app.use('/api/v1', apiRouter);

app.all('/api/*', (req, res, next) => {
  next(new ApiError(404, `No route for ${req.method} ${req.originalUrl}`));
});

// In production the API also serves the built React client.
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { maxAge: '1h' }));
  app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
} else {
  app.all('*', (req, res, next) => next(new ApiError(404, 'Not found')));
}

app.use(errorHandler);

module.exports = app;
