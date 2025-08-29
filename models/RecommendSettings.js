const mongoose = require('mongoose');

const RecommendSettingsSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true, unique: true },

  // where approved/posted embeds go
  threadId: { type: String, default: null },

  // mod log / approval channel
  modChannelId: { type: String, default: null },

  // feature switch
  active: { type: Boolean, default: false },

  // reaction to add to posted messages (unicode or custom)
  reaction: { type: String, default: '<:e_heart:1410767827857571961>' },

  // per-user cooldown in seconds
  cooldownSeconds: { type: Number, default: 60 },

  // if true, submit -> mod approval buttons; otherwise auto-post
  approvalRequired: { type: Boolean, default: true },

  // ✅ NEW: which roles are allowed to use /recommend submit
  // if empty, anyone can submit; if not empty, user must have at least one
  allowedRoleIds: { type: [String], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('RecommendSettings', RecommendSettingsSchema);