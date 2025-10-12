const MarketListing = require('../../../models/MarketListing');
// ⬇️ Old: UserInventory -> New: InventoryItem (1 doc per {userId, cardCode})
const InventoryItem = require('../../../models/InventoryItem');
const { safeReply } = require('../../../utils/safeReply');

module.exports = async function (interaction) {
  const input = interaction.options.getString('buycode');
  const userId = interaction.user.id;

  if (!input) {
    return safeReply(interaction, { content: 'Provide at least one buy code.' });
  }

  // normalize
  const buyCodes = input.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
  if (buyCodes.length === 0) {
    return safeReply(interaction, { content: 'Provide at least one valid buy code.' });
  }

  const results = [];

  for (const code of buyCodes) {
    // Find the listing
    const listing = await MarketListing.findOne({ buyCode: code }).lean();
    if (!listing) {
      results.push(`No listing found for \`${code}\`.`);
      continue;
    }

    // Must be owned by the clicker
    if (listing.sellerId !== userId) {
      results.push(`You do not own listing \`${code}\`.`);
      continue;
    }

    // ✅ Return card to inventory with per-item model (upsert + increment)
    await InventoryItem.findOneAndUpdate(
      { userId, cardCode: listing.cardCode },
      { $inc: { quantity: 1 } },
      { upsert: true, new: true }
    );

    // Remove the market listing
    await MarketListing.deleteOne({ _id: listing._id });

    results.push(
      `Removed **${listing.cardName}** \`${listing.cardCode}\` ${code} & returned to inventory.`
    );
  }

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
    .setTitle('Removed Listings')
    .setDescription(pageItems)
    .setColor('#FF9800')
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
  const btn = await awaitUserButton(interaction, userId, ['first', 'prev', 'next', 'last'], 120000);
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