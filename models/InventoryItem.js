// models/InventoryItem.js
const mongoose = require('mongoose');

const InventoryItemSchema = new mongoose.Schema({
  userId:   { type: String, required: true },
  cardCode: { type: String, required: true },
  quantity: { type: Number, required: true, default: 0, min: 0 }
}, {
  timestamps: false,
  versionKey: false
});

// Unique per (user, card)
InventoryItemSchema.index({ userId: 1, cardCode: 1 }, { unique: true });
// Optional helper for “sort by quantity”
InventoryItemSchema.index({ userId: 1, quantity: -1 });

module.exports = mongoose.model('InventoryItem', InventoryItemSchema);