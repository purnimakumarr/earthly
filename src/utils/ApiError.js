// An error we raised on purpose and whose message is safe to show to clients.
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.status = statusCode >= 400 && statusCode < 500 ? 'fail' : 'error';
    this.expected = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
