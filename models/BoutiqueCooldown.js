const mongoose = require('mongoose');

const boutiqueCooldownSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  expiresAt: { type: Date, required: true }
});

module.exports = mongoose.model('BoutiqueCooldown', boutiqueCooldownSchema);