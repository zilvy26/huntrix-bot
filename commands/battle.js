const User = require('../../models/User');
const Question = require('../../models/Question');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  data: {
    name: 'battle',
    description: 'Answer a trivia question to earn rewards!'
  },
  async execute(interaction) {
    await interaction.deferReply();

    const userId = interaction.user.id;
    const user = await User.findOne({ userId });
    if (!user) {
      return interaction.editReply('❌ You must register first using `/register`.');
    }

    const question = await Question.aggregate([{ $sample: { size: 1 } }]);
    const selected = question[0];
    if (!selected) {
      return interaction.editReply('❌ No question available at the moment.');
    }

    // Embed
    const embed = new EmbedBuilder()
      .setTitle('🧠 Battle Question')
      .setDescription(selected.question)
      .setColor(0x0099ff);

    if (selected.image) embed.setImage(selected.image);

    // Button Row
    const row = new ActionRowBuilder();
    for (let i = 0; i < selected.options.length; i++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`question_${i}`)
          .setLabel(selected.options[i])
          .setStyle(ButtonStyle.Secondary)
      );
    }

    await interaction.editReply({
      embeds: [embed],
      components: [row]
    });

    // Store context for the router to handle later
    const metadata = {
      userId,
      questionId: selected._id.toString(),
      correct: selected.correct,
      options: selected.options,
      timestamp: Date.now()
    };

    interaction.client.battleMetadata ??= new Map();
    interaction.client.battleMetadata.set(userId, metadata);
  }
};