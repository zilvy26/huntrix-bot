// models/Blacklist.js
const mongoose = require('mongoose');

const blacklistSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  reason: { type: String, default: 'No reason provided' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Blacklist', blacklistSchema);