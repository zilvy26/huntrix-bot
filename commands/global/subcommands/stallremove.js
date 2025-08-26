const MarketListing = require('../../../models/MarketListing');
const UserInventory = require('../../../models/UserInventory');
const { safeReply } = require('../../../utils/safeReply');

module.exports = async function(interaction) {
  const input = interaction.options.getString('buycode');
  const userId = interaction.user.id;

  const codes = input.split(',').map(c => c.trim().toUpperCase());
  const results = [];

  for (const code of codes) {
    const listing = await MarketListing.findOne({ buyCode: code });

    if (!listing) {
      results.push(`No listing found for \`${code}\`.`);
      continue;
    }

    if (listing.sellerId !== userId) {
      results.push(`You do not own listing \`${code}\`.`);
      continue;
    }

    // Restore card
    const result = await UserInventory.findOneAndUpdate(
      { userId, 'cards.cardCode': listing.cardCode },
      { $inc: { 'cards.$.quantity': 1 } },
      { new: true }
    );

    if (!result) {
      await UserInventory.findOneAndUpdate(
        { userId },
        { $push: { cards: { cardCode: listing.cardCode, quantity: 1 } } },
        { upsert: true }
      );
    }

    await MarketListing.deleteOne({ _id: listing._id });

    results.push(`Removed **${listing.cardName}** \`${listing.cardCode}\` ${code} & returned to inventory.`);
  }

  return safeReply(interaction, { content: results.join('\n').slice(0, 2000) });
};