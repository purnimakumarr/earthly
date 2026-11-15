// Runs before each test file, ahead of any require of src/config.
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-in-tests',
  JWT_SECRET: 'test-secret-test-secret-test-secret-0123',
  JWT_EXPIRES_IN: '1h',
  CLIENT_URL: 'http://localhost:5173',
  SMTP_HOST: '',
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'rzp_test_secret',
  RAZORPAY_WEBHOOK_SECRET: 'whsec_test',
});
