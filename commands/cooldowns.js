const { SlashCommandBuilder } = require('discord.js');
const cooldownManager = require('../utils/cooldownManager');
const cooldownConfig = require('../utils/cooldownConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cooldowns')
    .setDescription('View your current and available cooldowns'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    const cooldowns = await cooldownManager.getCooldowns(userId);

    const lines = [];

    for (const command in cooldownConfig) {
      const cdDurationMs = cooldownConfig[command];
      const expiresAt = cooldowns[command];

      if (!expiresAt || expiresAt < now) {
        lines.push(`\`${command}\` — ready to use`);
      } else {
        const remainingMs = expiresAt - now;
        const seconds = Math.floor((remainingMs / 1000) % 60);
        const minutes = Math.floor((remainingMs / (1000 * 60)) % 60);
        const hours = Math.floor(remainingMs / (1000 * 60 * 60));

        let timeStr = '';
        if (hours > 0) timeStr += `${hours}h `;
        if (minutes > 0) timeStr += `${minutes}m `;
        timeStr += `${seconds}s`;

        lines.push(`\`${command}\` — ${timeStr} remaining`);
      }
    }

    const response = lines.join('\n');

    await interaction.reply({
      content: `Cooldowns for <@${userId}>:\n\n${response}`,
      ephemeral: true
    });
  }
};