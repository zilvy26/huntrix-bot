const { SlashCommandBuilder } = require('discord.js');
const MarketListing = require('../../../models/MarketListing');
const User = require('../../../models/User');
const UserInventory = require('../../../models/UserInventory');
const UserRecord = require('../../../models/UserRecord');
const safeReply = require('../../../utils/safeReply');

module.exports = async function(interaction) {
  const input = interaction.options.getString('buycode');
  const buyerId = interaction.user.id;
  const codes = input.split(',').map(c => c.trim().toUpperCase());

  const buyer = await User.findOne({ userId: buyerId });
  if (!buyer) return interaction.reply({ content: 'Buyer profile not found.' });

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

    // Deduct buyer currency
    buyer.patterns -= listing.price;

    // Credit seller
    await User.findOneAndUpdate(
      { userId: listing.sellerId },
      { $inc: { patterns: listing.price } }
    );

    // Add card to inventory
    const result = await UserInventory.findOneAndUpdate(
      { userId: buyerId, 'cards.cardCode': listing.cardCode },
      { $inc: { 'cards.$.quantity': 1 } },
      { new: true }
    );

    if (!result) {
      await UserInventory.findOneAndUpdate(
        { userId: buyerId },
        { $push: { cards: { cardCode: listing.cardCode, quantity: 1 } } },
        { upsert: true }
      );
    }

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

    try {
      const sellerUser = await interaction.client.users.fetch(listing.sellerId);
      await sellerUser.send(`<@${buyerId}> purchased **${listing.cardName}** \`${listing.cardCode}\` for **${listing.price} Patterns**!`);
    } catch (e) {
      console.warn('DM failed:', e.message);
    }

    await listing.deleteOne();
    totalCost += listing.price;
    results.push(`Bought **${listing.cardName}** \`${listing.cardCode}\` \`${code}\` for **${listing.price} Patterns**`);
  }

  await buyer.save();

  return interaction.reply({
    content: `Purchase complete:\n${results.join('\n')}\n\n Total Spent: **${totalCost} Patterns**`
  });
};