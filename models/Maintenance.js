const mongoose = require('mongoose');

const maintenanceSchema = new mongoose.Schema({
  active: { type: Boolean, default: false }
});

module.exports = mongoose.model('Maintenance', maintenanceSchema);