const { SlashCommandBuilder } = require('discord.js');
const Question = require('../models/Question');
const uploadCardImage = require('../utils/imageUploader'); // Adjust path if needed

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addquestion')
    .setDescription('Add a new question')
    .addStringOption(opt => 
      opt.setName('difficulty')
        .setDescription('Difficulty level')
        .setRequired(true)
        .addChoices(
          { name: 'Demons (Easy)', value: 'easy' },
          { name: 'Hunters (Hard)', value: 'hard' }
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
        .setDescription('Optional image file')),

  async execute(interaction) {
    await interaction.deferReply(); // Acknowledge right away

    const difficulty = interaction.options.getString('difficulty');
    const questionText = interaction.options.getString('question');
    const options = interaction.options.getString('options').split(',').map(opt => opt.trim());
    const correct = interaction.options.getString('correct');
    const imageAttachment = interaction.options.getAttachment('image');

    if (!options.includes(correct)) {
      return interaction.editReply({
        content: "❌ The correct answer must be one of the provided options."
      });
    }

    let imageUrl = null;
    if (imageAttachment) {
      try {
        const { imgurUrl } = await uploadCardImage(interaction.client, imageAttachment.url, questionText, `question-${Date.now()}`);
        imageUrl = imgurUrl;
        if (!imgurUrl) {
          return interaction.editReply({
            content: "⚠️ Failed to upload image to Imgur. Try again or use another image."
          });
        }
      } catch (err) {
        return interaction.editReply({
          content: `❌ Image upload failed: ${err.message}`
        });
      }
    }

    await Question.create({
      difficulty,
      question: questionText,
      options,
      correct,
      image: imageUrl
    });

    await interaction.editReply({
      content: "✅ Question added successfully!"
    });
  }
};