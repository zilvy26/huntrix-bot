const mongoose = require('mongoose');

const chartSnapshotSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  filterType: { type: String, default: 'all' }, // e.g., 'all', 'group', 'name', 'era'
  filterValue: { type: String, default: '' },
  totalCards: { type: Number, default: 0 },
  totalStars: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
});

chartSnapshotSchema.index({ userId: 1, filterType: 1, filterValue: 1 }, { unique: true });

module.exports = mongoose.model('ChartSnapshot', chartSnapshotSchema);