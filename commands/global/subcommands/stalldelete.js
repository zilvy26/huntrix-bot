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
  return safeReply(interaction, {
    content: results.join('\n').slice(0, 2000)
  });
};