const mongoose = require('mongoose');

const redeemCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },

  // Rewards
  reward: {
    patterns: { type: Number, default: 0 },
    sopop: { type: Number, default: 0 },
  },
  cardCode: { type: String }, // specific card reward
  allowCardChoice: { type: Boolean, default: false }, // allows user to choose a card

  // Control
  maxUses: { type: Number, default: 1 },
  usedBy: { type: [String], default: [] },
  expiresAt: { type: Date }
});

module.exports = mongoose.model('RedeemCode', redeemCodeSchema);