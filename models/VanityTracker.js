const mongoose = require('mongoose');

const vanityTrackerSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  hasVanity: { type: Boolean, default: false },
  lastChecked: { type: Date, default: Date.now }
});

module.exports = mongoose.model('VanityTracker', vanityTrackerSchema);