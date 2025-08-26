const MarketListing = require('../../../models/MarketListing');
const UserInventory = require('../../../models/UserInventory');
const { safeReply } = require('../../../utils/safeReply');

const GRANTING_ROLE_ID = process.env.GRANTING_ROLE_ID;

module.exports = async function(interaction) {
  const member = interaction.member;
  const buyCodes = interaction.options.getString('buycode').split(',').map(c => c.trim().toUpperCase());

  if (!member.roles.cache.has(GRANTING_ROLE_ID)) {
    return safeReply(interaction, { content: 'You do not have permission to use this command.' });
  }

  const results = [];

  for (const code of buyCodes) {
    const listing = await MarketListing.findOne({ buyCode: code });

    if (!listing) {
      results.push(`No listing found for \`${code}\``);
      continue;
    }

    const inv = await UserInventory.findOneAndUpdate(
      { userId: listing.sellerId, 'cards.cardCode': listing.cardCode },
      { $inc: { 'cards.$.quantity': 1 } },
      { new: true }
    );

    if (!inv) {
      await UserInventory.findOneAndUpdate(
        { userId: listing.sellerId },
        { $push: { cards: { cardCode: listing.cardCode, quantity: 1 } } },
        { upsert: true }
      );
    }

    await listing.deleteOne();

    results.push(`Force-deleted \`${code}\` | Returned **${listing.cardCode}** to <@${listing.sellerId}>`);
  }

  return safeReply(interaction, { content: results.join('\n').slice(0, 2000) });
};