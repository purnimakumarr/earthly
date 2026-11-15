module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/helpers/env.js'],
  testTimeout: 30_000,
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
};
