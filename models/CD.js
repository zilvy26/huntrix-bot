// models/CD.js
const mongoose = require('mongoose');

const CDSchema = new mongoose.Schema({
  title: { type: String, required: true, unique: true, index: true },
  activeEra: { type: String, default: null },
  inactiveEra: { type: String, default: null },
  active: { type: Boolean, default: true },     // true => requires active era only; false => requires both
  available: { type: Boolean, default: true },  // can people get it?
  localImagePath: { type: String, required: true },
  createdBy: { type: String, required: true },  // Discord user id
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CD', CDSchema);