const os = require('os');
const path = require('path');

// Runs before each test file, ahead of any require of src/config.
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-in-tests',
  JWT_SECRET: 'test-secret-test-secret-test-secret-0123',
  ACCESS_TOKEN_TTL: '15m',
  CLIENT_URL: 'http://localhost:5173',
  SMTP_HOST: '',
  // Uploads made by tests stay out of the project's own uploads folder.
  UPLOAD_DIR: path.join(os.tmpdir(), 'earthly-test-uploads'),
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'rzp_test_secret',
  RAZORPAY_WEBHOOK_SECRET: 'whsec_test',
});
