const MarketListing = require('../../models/MarketListing');
const UserInventory = require('../../models/UserInventory');

module.exports = async function(interaction) {
  const buyCode = interaction.options.getString('buycode').toUpperCase();
  const userId = interaction.user.id;

  const listing = await MarketListing.findOne({ buyCode });

  if (!listing) {
    return interaction.reply({ content: `No listing found for Buy Code \`${buyCode}\`.` });
  }

  if (listing.sellerId !== userId) {
    return interaction.reply({ content: `You can only remove your own listings.` });
  }

  // Restore the card to inventory
  const result = await UserInventory.findOneAndUpdate(
    { userId, 'cards.cardCode': listing.cardCode },
    { $inc: { 'cards.$.quantity': 1 } },
    { new: true }
  );

  // If not already in inventory, push it
  if (!result) {
    await UserInventory.findOneAndUpdate(
      { userId },
      { $push: { cards: { cardCode: listing.cardCode, quantity: 1 } } },
      { upsert: true }
    );
  }

  // Delete the listing
  await MarketListing.deleteOne({ _id: listing._id });

  return interaction.reply({
    content: `Successfully removed your listing for **${listing.cardName}**.\n💼 The card has been returned to your inventory.`,
  });
};