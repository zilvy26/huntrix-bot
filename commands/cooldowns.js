const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const cooldownManager = require('../utils/cooldownManager');
const cooldownConfig = require('../utils/cooldownConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cooldowns')
    .setDescription('View your current and available cooldowns'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    const readyLines = [];
    const cooldownLines = [];

    for (const command of Object.keys(cooldownConfig)) {
      const expires = cooldownManager.getCooldowns(command, userId);

      if (expires && expires > now) {
        const unix = Math.floor(expires / 1000);
        cooldownLines.push(`\`/${command}\` — <t:${unix}:F> — <t:${unix}:R>`);
      } else {
        readyLines.push(`\`/${command}\` — ready to use`);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('Your Cooldowns')
      .setColor('#2f3136')
      .setDescription([...readyLines, ...cooldownLines].join('\n') || 'No cooldowns tracked.');

    await interaction.reply({ embeds: [embed] });
  }
};