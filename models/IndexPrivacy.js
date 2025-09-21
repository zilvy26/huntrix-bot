// models/IndexPrivacy.js
const mongoose = require('mongoose');

const IndexPrivacySchema = new mongoose.Schema({
  userId: { type: String, index: true, unique: true, required: true },
  hideAll: { type: Boolean, default: false },
  cards:  { type: [String], default: [] }, // cardCode(s)
  groups: { type: [String], default: [] },
  names:  { type: [String], default: [] },
  eras:   { type: [String], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('IndexPrivacy', IndexPrivacySchema);