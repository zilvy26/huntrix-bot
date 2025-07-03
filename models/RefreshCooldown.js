const mongoose = require('mongoose');

const refreshCooldownSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  lastUsed: { type: Date, required: true }
});

module.exports = mongoose.model('RefreshCooldown', refreshCooldownSchema);