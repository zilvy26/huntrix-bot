// models/UserProfile.js

const mongoose = require('mongoose');

const userProfileSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  aboutMe: { type: String, default: '' },
  favoriteCard: { type: String, default: '' }, // cardCode from UserInventory
  template: { type: String, default: 'profile_base' },
  patterns: { type: Number, default: 0 },
  sopop: { type: Number, default: 0 },

  // Placeholder for badges array, which you can expand later
  badges: [
    {
      name: { type: String },
      iconUrl: { type: String },  // Image link or CDN path for badge icon
      description: { type: String },
      earnedAt: { type: Date, default: Date.now }
    }
  ]
});

module.exports = mongoose.model('UserProfile', userProfileSchema);