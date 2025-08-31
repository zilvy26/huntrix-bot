// services/templateInventory.js
const UserTemplateInventory = require('../models/UserTemplateInventory');
const { DEFAULT_TEMPLATE_LABEL } = require('../config/profile');

async function ensureDefaultTemplate(userId) {
  await UserTemplateInventory.updateOne(
    { userId },
    { $addToSet: { templates: DEFAULT_TEMPLATE_LABEL } },
    { upsert: true }
  );
}

module.exports = { ensureDefaultTemplate };