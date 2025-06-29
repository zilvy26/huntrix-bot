const mongoose = require('mongoose');

const userInventorySchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true }, // Discord user ID
  cards: [
    {
      cardCode: { type: String, required: true },
      quantity: { type: Number, default: 1 }
    }
  ]
}, {
  timestamps: true
});

module.exports = mongoose.model('UserInventory', userInventorySchema);