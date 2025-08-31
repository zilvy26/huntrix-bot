// models/UserProfile.js  (augment your existing schema)
const mongoose = require('mongoose');

const DEFAULT_TEMPLATE_LABEL = process.env.DEFAULT_TEMPLATE_LABEL || 'Base';

const userProfileSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  aboutMe: { type: String, default: '' },
  favoriteCard: { type: String, default: '' }, // cardCode from UserInventory

  // legacy id-style (keep for compatibility / fallback)
  template: { type: String, default: 'profile_base' },

  // NEW: label-first system
  templateLabel: { type: String, default: DEFAULT_TEMPLATE_LABEL },

  patterns: { type: Number, default: 0 },
  sopop: { type: Number, default: 0 },
});

module.exports = mongoose.model('UserProfile', userProfileSchema);