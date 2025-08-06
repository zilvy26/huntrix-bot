const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const Question = require('../../models/Question');
const cooldowns = require('../../utils/cooldownManager');
const cooldownConfig = require('../../utils/cooldownConfig');
const handleReminders = require('../../utils/reminderHandler');
const safeReply = require('../../utils/safeReply');

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
          { name: 'Hunters (Hard)', value: 'hard' },
          { name: 'the Honmoon (Impossible)', value: 'impossible' }
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
    const commandName = 'Battle';
    const cooldownMs = await cooldowns.getEffectiveCooldown(interaction, commandName);

    if (await cooldowns.isOnCooldown(userId, commandName)) {
      const endsAt = await cooldowns.getCooldownTimestamp(userId, commandName);
      return safeReply(interaction, {
        content: `You must wait before battling again. Try ${endsAt}`,
      });
    }

    await cooldowns.setCooldown(userId, commandName, cooldownMs);
    await handleReminders(interaction, commandName, cooldownMs);

    const difficulty = interaction.options.getString('difficulty');

    const questions = await Question.aggregate([
      { $match: { difficulty } },
      { $sample: { size: 1 } }
    ]);

    if (!questions.length) {
      return safeReply(interaction, { content: 'No questions found for this difficulty.' });
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
      .setTitle('Battle Question')
      .setDescription(`**${selected.question}**`)
      .setColor('#b5dff9');

    if (selected.localImagePath) {
      const fullPath = path.resolve(__dirname, '../../..', selected.localImagePath);
      if (fs.existsSync(fullPath)) {
        embed.setImage(`attachment://${path.basename(fullPath)}`);
        await safeReply(interaction, {
          embeds: [embed],
          components: [buttons],
          files: [fullPath]
        });
        return;
      }
    }

    // Fallback if no local image
    await safeReply(interaction, {
      embeds: [embed],
      components: [buttons]
    });
  }
};