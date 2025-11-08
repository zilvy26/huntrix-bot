const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  reminderPreferences: {
  reminder: { type: Boolean, default: false },
  remindInChannel: { type: Boolean, default: true }
},
  username: String,
  patterns: { type: Number, default: 15000 }, // primary grindable currency
  sopop: { type: Number, default: 0 },    // premium/rare currency
  dailystreak: {
    count: { type: Number, default: 0},
    lastClaim: { type: Date, default: null }
  },
  templatesOwned: {
  type: [String],
  default: []
},
preferredCategories: {
    type: [String],
    enum: ['kpop', 'anime', 'game', 'franchise'],
    default: []
  },
  correctStreak: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);