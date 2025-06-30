const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  reminderPreferences: {
  reminder: { type: Boolean, default: false },
  remindInChannel: { type: Boolean, default: true }
},
  username: String,
  patterns: { type: Number, default: 5000 }, // primary grindable currency
  sopop: { type: Number, default: 1 },    // premium/rare currency
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);