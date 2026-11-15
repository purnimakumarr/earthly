const mongoose = require('mongoose');
const config = require('./config');
const logger = require('./config/logger');

// A bug outside any request cycle leaves the process in an unknown state.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception, exiting');
  process.exit(1);
});

const app = require('./app');

let server;

const shutdown = (signal, code = 0) => {
  logger.info({ signal }, 'shutting down');

  const closeDb = () => mongoose.connection.close().finally(() => process.exit(code));

  // Stop accepting connections, let in-flight requests finish, then exit.
  if (server) server.close(closeDb);
  else closeDb();

  setTimeout(() => process.exit(1), 10_000).unref();
};

const start = async () => {
  await mongoose.connect(config.mongo.uri, { dbName: config.mongo.dbName });
  logger.info({ db: config.mongo.dbName }, 'database connected');

  server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'api listening');
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'unhandled promise rejection');
  shutdown('unhandledRejection', 1);
});

start().catch((err) => {
  logger.fatal({ err }, 'startup failed');
  process.exit(1);
});
