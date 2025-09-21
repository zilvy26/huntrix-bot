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

  return safeReply(interaction, {
    content: results.join('\n').slice(0, 2000)
  });
};