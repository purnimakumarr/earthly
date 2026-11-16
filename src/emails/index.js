const layout = require('./layout');

exports.verifyEmail = ({ firstName, url }) => ({
  subject: 'Confirm your email for Earthly',
  html: layout({
    heading: `Good to have you, ${firstName}.`,
    paragraphs: [
      'Earthly runs small-group expeditions with local naturalists, and a share of every booking goes to the conservation work in that region.',
      'Confirm this address to finish setting up your account. You can browse without it, but booking and reviewing need a confirmed email. The link works for 24 hours.',
    ],
    action: { label: 'Confirm email address', url },
  }),
});

exports.passwordReset = ({ firstName, url }) => ({
  subject: 'Reset your Earthly password (link valid for 10 minutes)',
  html: layout({
    heading: `Reset your password, ${firstName}`,
    paragraphs: [
      'Someone asked to reset the password on this account. The button below opens a page where you can choose a new one. It stops working after 10 minutes.',
      'If that was not you, ignore this email and nothing will change.',
    ],
    action: { label: 'Choose a new password', url },
  }),
});

exports.emailChanged = ({ firstName, newEmail }) => ({
  subject: 'The email address on your Earthly account was changed',
  html: layout({
    heading: `Your email address was changed, ${firstName}`,
    paragraphs: [
      `The email address on your Earthly account is now ${newEmail}. Messages from us will go there from now on.`,
      'If you made this change, there is nothing more to do. If you did not, someone else has access to your account: reply to this email straight away so we can help you get it back.',
    ],
  }),
});
