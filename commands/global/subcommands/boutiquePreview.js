const { EmbedBuilder } = require('discord.js');
const templateOptions = require('../../../data/templateOptions');
const User = require('../../../models/User');

module.exports = async function(interaction) {
  const user = await User.findOne({ userId: interaction.user.id });

  // 💳 Card Pull Prices
  const cardOptions = [
    { name: "20x Random + Guaranteed 5S", price: "12,500 Patterns" },
    { name: "10x Cards of Choice", price: "8,500 Patterns" },
    { name: "1x Special Pull", price: "2 Sopop" }
  ];

  const embed = new EmbedBuilder()
    .setTitle('Boutique Price List')
    .setColor('#f39c12')
    .setDescription(
      `**Card Pulls**\n` +
      cardOptions.map(o => `• **${o.name}** — ${o.price}`).join('\n') +
      `\n\n**Profile Templates**\n` +
      templateOptions.map(t => {
        const owned = user.templatesOwned?.includes(t.id);
        return `• **${t.name}**${owned ? ' *(Owned)*' : ''} — ${t.price.toLocaleString()} Sopop`;
      }).join('\n')
    )
    .setFooter({ text: 'Use /boutique cards or /boutique decors to buy items.' });

  await interaction.reply({ embeds: [embed] });
};