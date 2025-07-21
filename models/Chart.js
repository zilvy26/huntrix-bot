const mongoose = require('mongoose');

const chartSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  totalCards: {
    type: Number,
    default: 0
  },
  totalStars: {
    type: Number,
    default: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Chart', chartSchema);