const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  type: { type: String, required: true },
  targetId: { type: String },
  detail: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, index: { expires: '45d' } }
});

module.exports = mongoose.model('UserRecord', logSchema);