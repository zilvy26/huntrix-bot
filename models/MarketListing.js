// models/MarketListing.js
const mongoose = require('mongoose');

const marketListingSchema = new mongoose.Schema({
  sellerId: { type: String, required: true },
  sellerTag: { type: String, required: true },
  price:    { type: Number, required: true },

  // Card snapshot
  cardCode: { type: String, required: true },
  cardName: { type: String, required: true },
  group:    { type: String, required: true },
  era:      { type: String },
  emoji:    { type: String },
  rarity:   { type: Number, required: true },
  imageUrl: { type: String },
  localImagePath: { type: String },

  // 🔒 must be unique
  buyCode:  { type: String, required: true, trim: true },

  createdAt:{ type: Date, default: Date.now }
});

// ---- Indexes ----
// Globally unique buy codes
marketListingSchema.index({ buyCode: 1 }, { unique: true });

// Helpful for counting a user's listings fast
marketListingSchema.index({ sellerId: 1 });

module.exports = mongoose.model('MarketListing', marketListingSchema);