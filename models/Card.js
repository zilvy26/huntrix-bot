const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema({
  cardCode: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },                   // Display name
  category: { type: String, required: true},
  group: { type: String },                                  // Card group or series
  rarity: { type: Number, min: 0, max: 5, required:true },
  pullable: { type: Boolean, default: true},
  emoji: { type: String},
  era: { type: String },                                    // Era or expansion tag
  localImagePath: { type: String},
  designerIds: { type: [String], default: [] },                             // Discord user ID of the designer(s)
}, {
  timestamps: true
});

module.exports = mongoose.model('Card', cardSchema);