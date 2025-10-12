const { SlashCommandBuilder } = require('discord.js');
const { safeReply } = require('../../utils/safeReply');
const Question = require('../../models/Question');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editquestion')
    .setDescription('Edit an existing question by ID, question code, or correct answer')
    .setDefaultMemberPermissions('0')
    .addStringOption(opt =>
      opt.setName('id')
        .setDescription('The ID of the question to edit'))
    .addStringOption(opt =>
      opt.setName('questioncode')
        .setDescription('The question code of the question to edit'))
    .addStringOption(opt =>
      opt.setName('correct')
        .setDescription('Find question by its current correct answer'))
    .addStringOption(opt =>
      opt.setName('newquestion')
        .setDescription('Updated question text'))
    .addStringOption(opt =>
      opt.setName('newoptions')
        .setDescription('Updated comma-separated answer options'))
    .addStringOption(opt =>
      opt.setName('newcorrect')
        .setDescription('Updated correct answer'))
    .addStringOption(opt =>
      opt.setName('newdifficulty')
        .setDescription('Updated difficulty')
        .addChoices(
          { name: 'Demons (Easy)', value: 'easy' },
          { name: 'Hunters (Hard)', value: 'hard' },
          { name: 'the Honmoon (Impossible)', value: 'impossible' }
        ))
    .addStringOption(opt =>
      opt.setName('setcode')
        .setDescription('Set or update the Question Code'))
    .addAttachmentOption(opt =>
      opt.setName('image')
        .setDescription('Updated image'))
    .addBooleanOption(opt =>
      opt.setName('shuffleoptions')
        .setDescription('Shuffle current options')),

  async execute(interaction) {
    const id = interaction.options.getString('id');
    const questionCode = interaction.options.getString('questioncode');
    const correctSearch = interaction.options.getString('correct');

    const newQuestion = interaction.options.getString('newquestion');
    const newOptionsRaw = interaction.options.getString('newoptions');
    const newCorrect = interaction.options.getString('newcorrect');
    const newDifficulty = interaction.options.getString('newdifficulty');
    const setCode = interaction.options.getString('setcode');
    const newImage = interaction.options.getAttachment('image');
    const shuffleOptions = interaction.options.getBoolean('shuffleoptions');

    // 🔍 Determine question target
    let questionDoc = null;

    if (id) {
      questionDoc = await Question.findById(id);
    } else if (questionCode) {
      questionDoc = await Question.findOne({ questionCode });
    } else if (correctSearch) {
      questionDoc = await Question.findOne({ correct: correctSearch });
    }

    if (!questionDoc) return safeReply(interaction, { content: 'No matching question found.' });

    // ✏️ Edit fields
    if (newQuestion) questionDoc.question = newQuestion;
    if (newDifficulty) questionDoc.difficulty = newDifficulty;

    if (newOptionsRaw) {
      const newOptions = newOptionsRaw.split(',').map(opt => opt.trim());
      if (newCorrect && !newOptions.includes(newCorrect)) {
        return safeReply(interaction, { content: 'New correct answer must be in the new options.' });
      }
      questionDoc.options = newOptions;
    }

    if (newCorrect) {
      const opts = newOptionsRaw ? newOptionsRaw.split(',').map(opt => opt.trim()) : questionDoc.options;
      if (!opts.includes(newCorrect)) {
        return safeReply(interaction, { content: 'Correct answer must be in the options.' });
      }
      questionDoc.correct = newCorrect;
    }

    if (shuffleOptions) {
      questionDoc.options = questionDoc.options.sort(() => Math.random() - 0.5);
    }

    if (newImage) {
      try {
        const imageBuffer = await axios.get(newImage.url, { responseType: 'arraybuffer' });
        const fileName = `question-edit-${Date.now()}.png`;
        const savePath = path.join('/var/questions/', fileName);
        fs.writeFileSync(savePath, imageBuffer.data);
        questionDoc.localImagePath = savePath;
      } catch (err) {
        return safeReply(interaction, { content: `Image save failed: ${err.message}` });
      }
    }

    // 🆕 Add/Update Question Code
    // ✅ Validate unique questionCode, no auto-generation
if (setCode) {
  const existing = await Question.findOne({ questionCode: setCode, _id: { $ne: questionDoc._id } });
  if (existing) {
    return safeReply(interaction, {
      content: `The code "${setCode}" is already in use by another question. Please choose a different code.`
    });
  }
  questionDoc.questionCode = setCode;
}

    await questionDoc.save();

    return safeReply(interaction, {
      content: `Question updated successfully!\n**ID:** ${questionDoc._id}\n**Code:** ${questionDoc.questionCode}`
    });
  }
};
