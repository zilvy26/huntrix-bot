// models/Template.js
const mongoose = require('mongoose');

const AcquireSchema = new mongoose.Schema({
  price: { type: Number, min: 0, default: null },
  roles: { type: [String], default: [] },                // Discord role IDs
  requireEra: { type: String, default: null },
  requireEraComplete: { type: Boolean, default: false },
  available: { type: Boolean, default: false },          // free claim
}, { _id: false });

const TemplateSchema = new mongoose.Schema({
  code: { type: String, unique: true, sparse: true },    // optional
  label: { type: String, required: true, index: true },
  filename: { type: String, required: true },            // /var/templates/<file>
  active: { type: Boolean, default: true },
  boutiqueVisible: { type: Boolean, default: true },
  acquire: { type: AcquireSchema, default: () => ({}) },
}, { timestamps: true });

module.exports = mongoose.model('Template', TemplateSchema);
