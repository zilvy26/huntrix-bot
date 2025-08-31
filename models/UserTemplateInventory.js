// models/UserTemplateInventory.js
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  templates: { type: [String], default: [] } // store labels
}, { timestamps: true });

schema.statics.ensure = async function (userId) {
  let doc = await this.findOne({ userId });
  if (!doc) doc = await this.create({ userId, templates: [] });
  return doc;
};

module.exports = mongoose.model('UserTemplateInventory', schema);
