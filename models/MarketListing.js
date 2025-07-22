const mongoose = require('mongoose');

const marketListingSchema = new mongoose.Schema({
  sellerId: { type: String, required: true },          // User ID
  sellerTag: { type: String, required: true },         // Display name or tag
  price: { type: Number, required: true },             // Currency price

  // Card Info Snapshot
  cardCode: { type: String, required: true },          // Unique card identifier
  cardName: { type: String, required: true },          // e.g. Chawon
  group: { type: String, required: true },             // e.g. ICHILLIN'
  era: { type: String },               // e.g. Feelin' Hot
  emoji: { type: String },
  rarity: { type: Number, required: true },            // e.g. 2
  imageUrl: { type: String },          // For canvas rendering
  localImagePath: { type: String },
  buyCode: { type: String, required: true, unique: true},

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('MarketListing', marketListingSchema);