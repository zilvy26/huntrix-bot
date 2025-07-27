const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const cooldownManager = require('../../utils/cooldownManager');
const cooldownConfig = require('../../utils/cooldownConfig');

const emojiMap = {
  Pull: '<:e_pull:1393002254499581982>',
  Pull10: '<:e_pull_ten:1393008116295012403>',
  Rehearsal: '<:e_rehearsal:1393011624788627456>',
  Battle: '<:e_battle:1393020277671329822>',
  Daily: '<:e_daily:1393021981808656424>',
  Perform: '<:e_perform:1393015619162472459>'
};

const categories = {
  Cards: ['Pull', 'Pull10', 'Rehearsal'],
  Games: ['Battle'],
  Economy: ['Daily', 'Perform']
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cooldowns')
    .setDescription('View your current and available cooldowns'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    const cooldowns = await cooldownManager.getCooldowns(userId);
    const embed = new EmbedBuilder()
      .setTitle('Cooldowns')
      .setColor('#2f3136');

    for (const [category, commands] of Object.entries(categories)) {
      const lines = [];

      for (const command of commands) {
        const emoji = emojiMap[command] || '•';
        const expires = cooldowns[command];

        if (expires && expires > now) {
          const unix = Math.floor(expires / 1000);
          lines.push(`${emoji} **${command}** — <t:${unix}:R>`);
        } else {
          lines.push(`${emoji} **${command}** — Ready`);
        }
      }

      if (lines.length > 0) {
        embed.addFields({ name: `__${category}__`, value: lines.join('\n'), inline: false });
      }
    }

    await interaction.reply({ embeds: [embed] });
  }
};