// commands/global/market/force-delete.js  (name it as you prefer)
const MarketListing = require('../../../models/MarketListing');
// ⬇️ swap old UserInventory for the new per-item model:
const InventoryItem = require('../../../models/InventoryItem');
const { safeReply } = require('../../../utils/safeReply');

const GRANTING_ROLE_ID = process.env.GRANTING_ROLE_ID;

module.exports = async function(interaction) {
  const member = interaction.member;
  const raw = interaction.options.getString('buycode') || '';
  const buyCodes = raw.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);

  if (!member.roles.cache.has(GRANTING_ROLE_ID)) {
    return safeReply(interaction, { content: 'You do not have permission to use this command.' });
  }

  if (buyCodes.length === 0) {
    return safeReply(interaction, { content: 'Provide at least one buy code.' });
  }

  const results = [];

  for (const code of buyCodes) {
    const listing = await MarketListing.findOne({ buyCode: code });
    if (!listing) {
      results.push(`No listing found for \`${code}\``);
      continue;
    }

    // ✅ Return the card to the seller's inventory (new model)
    // Upsert + increment quantity by 1 for that { userId, cardCode }
    await InventoryItem.findOneAndUpdate(
      { userId: listing.sellerId, cardCode: listing.cardCode },
      { $inc: { quantity: 1 } },
      { upsert: true, new: true }
    );

    // Remove the listing
    await listing.deleteOne();

    results.push(
      `Force-deleted \`${code}\` | Returned **${listing.cardCode}** to <@${listing.sellerId}>`
    );
  }

  // Avoid Discord 2000 char limit
  const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const awaitUserButton = require('../../../utils/awaitUserButton');

let current = 0;
const perPage = 5;
const totalPages = Math.ceil(results.length / perPage);

const renderEmbed = () => {
  const pageItems = results.slice(current * perPage, (current + 1) * perPage).join('\n');
  return new EmbedBuilder()
    .setTitle('Force-Deleted Listings')
    .setDescription(pageItems)
    .setColor('#E53935')
    .setFooter({ text: `Page ${current + 1} of ${totalPages}` });
};

const renderRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary).setDisabled(current === 0).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
  new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary).setDisabled(current === 0).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
  new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary).setDisabled(current >= totalPages - 1).setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
  new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary).setDisabled(current >= totalPages - 1).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
);

await safeReply(interaction, { embeds: [renderEmbed()], components: [renderRow()] });

while (true) {
  const btn = await awaitUserButton(interaction, interaction.user.id, ['first', 'prev', 'next', 'last'], 120000);
  if (!btn) break;
  if (!btn.deferred && !btn.replied) await btn.deferUpdate();

  if (btn.customId === 'first') current = 0;
  if (btn.customId === 'prev') current = Math.max(0, current - 1);
  if (btn.customId === 'next') current = Math.min(totalPages - 1, current + 1);
  if (btn.customId === 'last') current = totalPages - 1;

  await interaction.editReply({ embeds: [renderEmbed()], components: [renderRow()] });
}

try {
  await interaction.editReply({ components: [] });
} catch {}
};