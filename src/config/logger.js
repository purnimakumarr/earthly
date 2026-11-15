const pino = require('pino');
const config = require('./index');

module.exports = pino({
  level: config.isTest ? 'silent' : config.isProd ? 'info' : 'debug',
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});
