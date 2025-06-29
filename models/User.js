const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: String,
  patterns: { type: Number, default: 1000 }, // primary grindable currency
  souls: { type: Number, default: 50 },    // premium/rare currency
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);