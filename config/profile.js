// config/profile.js
module.exports = {
  DEFAULT_TEMPLATE_LABEL: process.env.DEFAULT_TEMPLATE_LABEL || 'Base', // <- change to your starter
  // last-resort hard file fallback (ensure the file exists in /var/templates)
  DEFAULT_TEMPLATE_FILENAME: process.env.DEFAULT_TEMPLATE_FILENAME || 'profile_base.png',
};
