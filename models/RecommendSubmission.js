const mongoose = require('mongoose');

const RecommendSubmissionSchema = new mongoose.Schema({
  guildId:  { type: String, index: true, required: true },
  userId:   { type: String, index: true, required: true },
  threadId: { type: String, index: true, required: true }, // target thread

  name:  { type: String, required: true },
  group: { type: String, required: true },

  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'posted', 'cleared'],
    default: 'pending',
    index: true
  },

  // traceability
  modMessageId:    { type: String, default: null }, // message in mod channel
  postedMessageId: { type: String, default: null }  // message in thread
}, { timestamps: true });

module.exports = mongoose.model('RecommendSubmission', RecommendSubmissionSchema);