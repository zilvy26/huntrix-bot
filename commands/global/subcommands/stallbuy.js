
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

  return safeReply(interaction, {
    content: `Purchase complete:\n${results.join('\n')}\n\nTotal Spent: **${totalCost} Patterns**`
  });
};