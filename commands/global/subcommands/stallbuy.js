
const { SlashCommandBuilder } = require('discord.js');
const MarketListing = require('../../../models/MarketListing');
const User = require('../../../models/User');
// ⬇️ replaced UserInventory with InventoryItem
const InventoryItem = require('../../../models/InventoryItem');
const UserRecord = require('../../../models/UserRecord');
const { safeReply } = require('../../../utils/safeReply');

module.exports = async function (interaction) {
  const input = interaction.options.getString('buycode');
  const buyerId = interaction.user.id;
  const codes = input.split(',').map(c => c.trim().toUpperCase());

  const buyer = await User.findOne({ userId: buyerId });
  if (!buyer) return safeReply(interaction, { content: 'Buyer profile not found.' });

  const results = [];
  let totalCost = 0;

  for (const code of codes) {
    const listing = await MarketListing.findOne({ buyCode: code });
    if (!listing) {
      results.push(`No listing for \`${code}\`.`);
      continue;
    }

    if (listing.sellerId === buyerId) {
      results.push(`You can't buy your own listing \`${code}\`.`);
      continue;
    }

    if (buyer.patterns < listing.price) {
      results.push(`Not enough Patterns for \`${code}\` (**${listing.price}**)`);
      continue;
    }

    // Deduct buyer currency locally; we'll save once at the end
    buyer.patterns -= listing.price;

    // Credit seller immediately
    await User.findOneAndUpdate(
      { userId: listing.sellerId },
      { $inc: { patterns: listing.price } },
      { upsert: false }
    );

    // ✅ Add card to new per-item inventory: upsert + increment
    await InventoryItem.findOneAndUpdate(
      { userId: buyerId, cardCode: listing.cardCode },
      { $inc: { quantity: 1 } },
      { upsert: true, new: true }
    );

    // Log both sides
    await UserRecord.create({
      userId: buyerId,
      type: 'buy',
      targetId: listing.sellerId,
      detail: `Bought ${listing.cardName} (${listing.cardCode}) for ${listing.price} Patterns`
    });

    await UserRecord.create({
      userId: listing.sellerId,
      type: 'sell',
      targetId: buyerId,
      detail: `Sold ${listing.cardName} (${listing.cardCode}) for ${listing.price} Patterns`
    });

    // Notify seller (best-effort)
    try {
      const sellerUser = await interaction.client.users.fetch(listing.sellerId);
      await sellerUser.send(
        `<@${buyerId}> purchased **${listing.cardName}** \`${listing.cardCode}\` for **${listing.price} Patterns**!`
      );
    } catch (e) {
      console.warn('DM failed:', e?.message);
    }

    // Remove listing
    await listing.deleteOne();
    totalCost += listing.price;
    results.push(`Bought **${listing.cardName}** \`${listing.cardCode}\` \`${code}\` for **${listing.price} Patterns**`);
  }

  // Persist buyer balance change once
  await buyer.save();

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
    .setTitle('Purchase Complete')
    .setDescription(pageItems)
    .addFields({ name: 'Total Spent', value: `**${totalCost} Patterns**` })
    .setColor('#4CAF50')
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
  const btn = await awaitUserButton(interaction, buyerId, ['first', 'prev', 'next', 'last'], 120000);
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