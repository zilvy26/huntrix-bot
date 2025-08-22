// models/ListSet.js
const mongoose = require('mongoose');

const SlotSchema = new mongoose.Schema({
  idx: { type: Number, required: true },                        // 1..5
  cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Card', required: true },
  claimedBy: { type: String, default: null },                   // userId
  claimedAt: { type: Date, default: null }
}, { _id: false });

const ListSetSchema = new mongoose.Schema({
  guildId: { type: String, default: null },                     // null in DMs
  channelId: { type: String, required: true },                  // works for DMs & guilds
  messageId: { type: String, default: null },
  ownerId: { type: String, required: true },
  slots: { type: [SlotSchema], required: true },                // 5 slots
  claimers: { type: [String], default: [] },                    // userIds who’ve already claimed 1
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }                     // TTL
});

// Fast lookups + TTL
ListSetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
ListSetSchema.index({ _id: 1, 'slots.idx': 1, 'slots.claimedBy': 1 });

module.exports = mongoose.model('ListSet', ListSetSchema);