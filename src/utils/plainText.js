// Mongoose setter for free-text fields: drops markup and trims.
// Output is escaped again wherever it is rendered (React, emails).
module.exports = (value) =>
  typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : value;
