// models/Question.js
const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  difficulty: { type: String, enum: ['easy', 'hard', 'impossible'], required: true },
  question: { type: String, required: true },
  options: [{ type: String, required: true }],
  correct: { type: String, required: true },
  localImagePath: { type: String }
});

module.exports = mongoose.model('Question', questionSchema);