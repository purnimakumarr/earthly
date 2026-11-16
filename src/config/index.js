const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config({ path: path.join(__dirname, '../../.env'), quiet: true });

const optional = (schema) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB: z.string().default('earthly'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // Access tokens are short-lived; the refresh token keeps people signed in.
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().positive().default(30),
  // Encrypts two-factor seeds. Kept apart from JWT_SECRET so that rotating
  // the signing secret does not lock two-factor users out. Falls back to
  // JWT_SECRET when unset.
  SECRET_BOX_KEY: optional(
    z.string().min(32, 'SECRET_BOX_KEY must be at least 32 characters'),
  ),

  // Where uploaded images are written. Defaults to ./uploads in the project.
  UPLOAD_DIR: optional(z.string()),

  // Public origin of the site, used in links inside emails.
  // Falls back to the request host when unset.
  CLIENT_URL: optional(z.url()),

  EMAIL_FROM: z.string().default('Earthly <hello@earthly.example>'),
  SMTP_HOST: optional(z.string()),
  SMTP_PORT: optional(z.coerce.number().int().positive()),
  SMTP_USER: optional(z.string()),
  SMTP_PASS: optional(z.string()),

  RAZORPAY_KEY_ID: optional(z.string()),
  RAZORPAY_KEY_SECRET: optional(z.string()),
  RAZORPAY_WEBHOOK_SECRET: optional(z.string()),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // The logger depends on this module, so write directly.
  process.stderr.write(`Invalid environment configuration:\n${problems}\n`);
  process.exit(1);
}

const env = parsed.data;

module.exports = Object.freeze({
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  mongo: { uri: env.MONGODB_URI, dbName: env.MONGODB_DB },
  jwt: {
    secret: env.JWT_SECRET,
    accessTtl: env.ACCESS_TOKEN_TTL,
    refreshDays: env.REFRESH_TOKEN_DAYS,
  },
  secretBoxKey: env.SECRET_BOX_KEY || env.JWT_SECRET,
  clientUrl: env.CLIENT_URL,
  uploadDir: path.resolve(env.UPLOAD_DIR || path.join(__dirname, '../../uploads')),
  email: {
    from: env.EMAIL_FROM,
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
  razorpay: {
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  },
});
