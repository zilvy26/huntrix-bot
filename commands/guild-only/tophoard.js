const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const safeReply = require('../../utils/safeReply');
const UserInventory = require('../../models/UserInventory');
const Card = require('../../models/Card');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tophoard')
    .setDescription('View the top 25 most collected groups across all users')
    .setDefaultMemberPermissions('0'),

  async execute(interaction) {

    // ✅ Optional: Admin check
    const ALLOWED_ROLE_ID = '1386797486680703036'; // replace with your actual role ID

    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
    return safeReply(interaction, { content: 'Only authorized staff can use this command.' });
}

    // Fetch all inventories
    const inventories = await UserInventory.find({});
    const groupCounts = {};

    // Cache to avoid duplicate DB calls
    const cardCache = new Map();

    for (const inv of inventories) {
      for (const c of inv.cards) {
        const cardCode = c.cardCode;
        let card = cardCache.get(cardCode);

        if (!card) {
          card = await Card.findOne({ cardCode });
          if (!card) continue;
          cardCache.set(cardCode, card);
        }

        const group = card.group || 'Unknown';
        groupCounts[group] = (groupCounts[group] || 0) + c.quantity;
      }
    }

    // Convert to sorted array
    const sortedGroups = Object.entries(groupCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25);

    // Embed formatting
    const embed = new EmbedBuilder()
      .setTitle('Top 25 Hoarded Groups')
      .setColor('#ffaa00')
      .setDescription(
        sortedGroups.map(([group, count], i) => `**${i + 1}.** \`${group}\` — ${count} cards`).join('\n')
      )
      .setFooter({ text: 'Based on all user inventories' });

    await safeReply(interaction, { embeds: [embed] });
  }
};