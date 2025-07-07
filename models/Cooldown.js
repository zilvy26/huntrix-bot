const mongoose = require('mongoose');

const cooldownSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  commandName: { type: String, required: true },
  expiresAt: { type: Date, required: true }
});

cooldownSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // auto-delete expired

module.exports = mongoose.model('Cooldown', cooldownSchema);