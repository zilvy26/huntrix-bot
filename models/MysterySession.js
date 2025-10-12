// models/MysterySession.js
const mongoose = require('mongoose');

const mysterySessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  messageId: { type: String, required: true },
  outcomes: { type: [String], required: true }, // e.g. ['currency_gain', 'card_gain', ...]
  clicks: [{
    idx: Number,
    outcome: String
  }],
  createdAt: { type: Date, default: Date.now }
}, { timestamps: false });

module.exports = mongoose.model('MysterySession', mysterySessionSchema);