const { SlashCommandBuilder } = require('discord.js');
const {safeReply} = require('../../utils/safeReply');
const Question = require('../../models/Question');
const uploadCardImage = require('../../utils/imageUploader'); // Adjust path if needed

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addquestion')
    .setDescription('Add a new question')
    .setDefaultMemberPermissions('0')
    .addStringOption(opt => 
      opt.setName('difficulty')
        .setDescription('Difficulty level')
        .setRequired(true)
        .addChoices(
          { name: 'Demons (Easy)', value: 'easy' },
          { name: 'Hunters (Hard)', value: 'hard' },
          { name: 'the Honmoon (Impossible)', value: 'impossible' }
        ))
    .addStringOption(opt => 
      opt.setName('question')
        .setDescription('The question text')
        .setRequired(true))
    .addStringOption(opt => 
      opt.setName('options')
        .setDescription('Comma-separated answer options')
        .setRequired(true))
    .addStringOption(opt => 
      opt.setName('correct')
        .setDescription('The correct answer')
        .setRequired(true))
    .addAttachmentOption(opt =>
      opt.setName('image')
        .setDescription('image file')
        .setRequired(true)),

  async execute(interaction) { // Acknowledge right away

    const difficulty = interaction.options.getString('difficulty');
    const questionText = interaction.options.getString('question');
    const options = interaction.options.getString('options').split(',').map(opt => opt.trim());
    const correct = interaction.options.getString('correct');
    const imageAttachment = interaction.options.getAttachment('image');

    if (!options.includes(correct)) {
      return safeReply(interaction, {
        content: "The correct answer must be one of the provided options."
      });
    }

    const fs = require('fs');
    const path = require('path');
    const axios = require('axios');

let localImagePath = null;
if (imageAttachment) {
  try {
    const imageBuffer = await axios.get(imageAttachment.url, { responseType: 'arraybuffer' });
    const fileName = `question-${Date.now()}.png`;
    const savePath = path.join('/var/questions/', fileName);

    fs.writeFileSync(savePath, imageBuffer.data);
    localImagePath = savePath;
  } catch (err) {
    return safeReply(interaction, { content: `Image save failed: ${err.message}` });
  }
}

    await Question.create({
      difficulty,
      question: questionText,
      options,
      correct,
      localImagePath
    });

    await safeReply(interaction, {
      content: "Question added successfully!"
    });
  }
};