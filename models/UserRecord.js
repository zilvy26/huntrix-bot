const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  type: { type: String, required: true },
  targetId: { type: String },
  detail: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, index: { expires: 60 } }
});

module.exports = mongoose.model('UserRecord', logSchema);