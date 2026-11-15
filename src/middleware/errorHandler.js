const multer = require('multer');
const config = require('../config');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');

// Translate errors from libraries into client-safe ApiErrors.
const normalise = (err) => {
  if (err instanceof ApiError) return err;

  if (err.name === 'CastError') {
    return new ApiError(400, `"${err.value}" is not a valid ${err.path}.`);
  }

  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors).map((e) => e.message);
    return new ApiError(400, details.join('. '));
  }

  if (err.code === 11000) {
    const fields = Object.keys(err.keyValue || {});
    if (fields.includes('expedition') && fields.includes('user')) {
      return new ApiError(409, 'You have already reviewed this expedition.');
    }
    return new ApiError(409, `That ${fields[0] || 'value'} is already in use.`);
  }

  if (err.name === 'JsonWebTokenError') {
    return new ApiError(401, 'Invalid session. Please log in again.');
  }

  if (err.name === 'TokenExpiredError') {
    return new ApiError(401, 'Session expired. Please log in again.');
  }

  if (err instanceof multer.MulterError) {
    return new ApiError(400, `Upload rejected: ${err.message}.`);
  }

  if (err.type === 'entity.too.large') {
    return new ApiError(413, 'Request body is too large.');
  }

  if (err.type === 'entity.parse.failed') {
    return new ApiError(400, 'Request body is not valid JSON.');
  }

  return null;
};

module.exports = (err, req, res, next) => {
  const known = normalise(err);

  if (known) {
    return res
      .status(known.statusCode)
      .json({ status: known.status, message: known.message });
  }

  // Anything else is a bug or an outage: log it in full, reveal nothing.
  logger.error({ err, path: req.originalUrl }, 'unhandled error');

  res.status(500).json({
    status: 'error',
    message: 'Something went wrong on our side.',
    ...(config.isProd ? {} : { detail: err.message, stack: err.stack }),
  });
};
