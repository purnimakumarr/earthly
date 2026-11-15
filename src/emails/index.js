const layout = require('./layout');

exports.welcome = ({ firstName, url }) => ({
  subject: 'Welcome to Earthly',
  html: layout({
    heading: `Good to have you, ${firstName}.`,
    paragraphs: [
      'Your account is ready. Earthly runs small-group expeditions with local naturalists, and a share of every booking goes to the conservation work in that region.',
      'Have a look at what is leaving in the coming months whenever you like.',
    ],
    action: { label: 'Browse expeditions', url },
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
