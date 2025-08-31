// config/storage.js
const path = require('path');
module.exports = {
  TEMPLATES_DIR: process.env.TEMPLATES_DIR || path.join('/var', 'templates'),
  ALLOWED_EXT: new Set(['.png', '.jpg', '.jpeg', '.webp']),
  MAX_TEMPLATE_BYTES: 10 * 1024 * 1024 // 10MB
};