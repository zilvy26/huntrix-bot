const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const Question = require('../models/Question');
const cooldowns = require('../utils/cooldownManager');
const cooldownConfig = require('../utils/cooldownConfig');
const handleReminders = require('../utils/reminderHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('battle')
    .setDescription('Start a battle question and earn rewards!')
    .addStringOption(option =>
      option.setName('difficulty')
        .setDescription('Choose your difficulty')
        .setRequired(true)
        .addChoices(
          { name: 'Demons (Easy)', value: 'easy' },
          { name: 'Hunters (Hard)', value: 'hard' }
        ))
    .addBooleanOption(opt =>
      opt.setName('reminder')
        .setDescription('Remind you when cooldown ends')
        .setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('remindinchannel')
        .setDescription('Remind in the command channel instead of DM')
        .setRequired(false)),

  async execute(interaction) {
    const userId = interaction.user.id;
    const commandName = 'battle';
    const cooldownDuration = cooldownConfig[commandName] || (2 * 60 * 60 * 1000); // 2 hours

    if (await cooldowns.isOnCooldown(userId, commandName)) {
      const endsAt = await cooldowns.getCooldownTimestamp(userId, commandName);
      return interaction.reply({
        content: `⏳ You must wait before battling again. Try ${endsAt}`,
        
      });
    }

    await cooldowns.setCooldown(userId, commandName, cooldownDuration);
    await handleReminders(interaction, commandName, cooldownDuration);

    const questions = await Question.aggregate([
      { $match: { difficulty: interaction.options.getString('difficulty') } },
      { $sample: { size: 1 } }
    ]);

    if (!questions.length) {
      return interaction.reply({ content: '❌ No questions found for this difficulty.' });
    }

    const selected = questions[0];

    const buttons = new ActionRowBuilder().addComponents(
      selected.options.map((option, index) =>
        new ButtonBuilder()
          .setCustomId(`question_${selected._id}_${index}`)
          .setLabel(option)
          .setStyle(ButtonStyle.Primary)
      )
    );

    const embed = new EmbedBuilder()
      .setTitle('🛡️ Battle Question')
      .setDescription(`**${selected.question}**`)
      .setColor('#b5dff9');

    if (selected.image) embed.setImage(selected.image);

    await interaction.reply({ embeds: [embed], components: [buttons] });
  }
};