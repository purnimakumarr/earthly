const nodemailer = require('nodemailer');
const { convert } = require('html-to-text');
const config = require('../config');
const logger = require('../config/logger');
const templates = require('../emails');

let transport;

// Without SMTP settings (local runs, tests) messages are built but not sent.
const getTransport = () => {
  if (transport) return transport;

  const { host, port, user, pass } = config.email;

  transport =
    host && !config.isTest
      ? nodemailer.createTransport({ host, port, auth: { user, pass } })
      : nodemailer.createTransport({ jsonTransport: true });

  return transport;
};

const send = async (user, template, url, details = {}) => {
  const firstName = user.name.split(' ')[0];
  const { subject, html } = templates[template]({ firstName, url, ...details });

  const info = await getTransport().sendMail({
    from: config.email.from,
    to: user.email,
    subject,
    html,
    text: convert(html),
  });

  if (!config.email.host) {
    logger.debug({ to: user.email, subject, url }, 'email not sent (no SMTP configured)');
  }

  return info;
};

exports.sendVerification = (user, url) => send(user, 'verifyEmail', url);
exports.sendPasswordReset = (user, url) => send(user, 'passwordReset', url);
// Goes to the address the account used to have, so its owner hears about it.
exports.sendEmailChanged = (user, previousEmail) =>
  send({ name: user.name, email: previousEmail }, 'emailChanged', undefined, {
    newEmail: user.email,
  });
