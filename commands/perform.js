const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const cooldowns = require('../utils/cooldownManager');
const cooldownConfig = require('../utils/cooldownConfig');
const giveCurrency = require('../utils/giveCurrency');
const handleReminders = require('../utils/reminderHandler');

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shouldDropSopop() {
  // ~10% chance to get sopop
  return Math.random() < 0.10;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('perform')
    .setDescription('Perform for your fans and earn random currency!')
    .addBooleanOption(opt =>
      opt.setName('reminder')
        .setDescription('Remind you when cooldown ends')
        .setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('remindinchannel')
        .setDescription('Remind in the command channel instead of DM (default: true)')
        .setRequired(false)),

  async execute(interaction) {
    const userId = interaction.user.id;
    const commandName = 'perform';
    const cooldownDuration = cooldownConfig[commandName];

    if (cooldowns.isOnCooldown(userId, commandName)) {
      const nextTime = cooldowns.getCooldownTimestamp(userId, commandName);
      return interaction.reply({
        content: `🎭 You're tired from your last performance. Come back at **${nextTime}**.`,
        
      });
    }

    // Generate randomized rewards
    const patterns = getRandomInt(750, 1500);
    const sopop = shouldDropSopop() ? 1 : 0;

    // Give currency
    const user = await giveCurrency(userId, { patterns, sopop });

    // Set cooldown
    cooldowns.setCooldown(userId, commandName, cooldownDuration);

    await handleReminders(interaction, 'perform', cooldownDuration);

    // Create response
    const embed = new EmbedBuilder()
      .setTitle('🎤 Performance Complete!')
      .setDescription([
        `You earned:\n• **${patterns}** patterns`,
        sopop ? `• 🌟 **1** sopop` : `• 💤 No sopop this time`,
        `\n__Your Balance__:\n• ${user.patterns} patterns\n• ${user.sopop} sopop`
      ].join('\n'))
      .setColor('#f9a825');

    return interaction.reply({ embeds: [embed] });
  }
};