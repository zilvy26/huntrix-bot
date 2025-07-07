const mongoose = require('mongoose');

const userInventorySchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true, // index for faster lookups
  },
  binder: {
  type: [[String]],
  default: [[], [], []] // 3 pages, 8 slots each
},
  cards: {
    type: [
      {
        cardCode: { type: String, required: true },
        quantity: { type: Number, default: 1 },
      }
    ],
    default: [], // ensures .cards is always an array
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('UserInventory', userInventorySchema);