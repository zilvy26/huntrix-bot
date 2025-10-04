// models/UserCD.js
const mongoose = require('mongoose');

const UserCDSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  cdId: { type: mongoose.Schema.Types.ObjectId, ref: 'CD', required: true, index: true },
  claimedAt: { type: Date, default: Date.now }
}, { timestamps: true });

UserCDSchema.index({ userId: 1, cdId: 1 }, { unique: true });

module.exports = mongoose.model('UserCD', UserCDSchema);