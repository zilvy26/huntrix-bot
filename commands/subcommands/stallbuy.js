const { SlashCommandBuilder } = require('discord.js');
const MarketListing = require('../../models/MarketListing');
const User = require('../../models/User');
const UserInventory = require('../../models/UserInventory');
const UserRecord = require('../../models/UserRecord');

module.exports = async function(interaction) {
  const buyCode = interaction.options.getString('buycode').toUpperCase();

  const listing = await MarketListing.findOne({ buyCode });
  if (!listing) {
    return interaction.reply({ content: '❌ No listing found with that Buy Code.' });
  }

  if (listing.sellerId === interaction.user.id) {
    return interaction.reply({ content: '❌ You cannot buy your own listing.' });
  }

  const buyer = await User.findOne({ userId: interaction.user.id });
  if (!buyer || buyer.patterns < listing.price) {
    return interaction.reply({ content: `❌ You need ${listing.price} Patterns to buy this card.` });
  }

  // Deduct Patterns from buyer
  buyer.patterns -= listing.price;
  await buyer.save();

  // Give Patterns to seller
  await User.findOneAndUpdate(
    { userId: listing.sellerId },
    { $inc: { patterns: listing.price } }
  );

  // Transfer card into buyer inventory (handle existing quantity)
  const inventory = await UserInventory.findOneAndUpdate(
    { userId: interaction.user.id, 'cards.cardCode': listing.cardCode },
    { $inc: { 'cards.$.quantity': 1 } },
    { new: true }
  );

  if (!inventory) {
    // If card doesn't exist in inventory, push new
    await UserInventory.findOneAndUpdate(
      { userId: interaction.user.id },
      { $push: { cards: { cardCode: listing.cardCode, quantity: 1 } } },
      { upsert: true }
    );
  }

  // Log transaction
  await UserRecord.create({
    userId: buyer.userId,
    type: 'buy',
    targetId: listing.sellerId,
    detail: `Bought ${listing.cardName} (${listing.cardCode}) for ${listing.price} Patterns from <@${listing.sellerId}>`
  });

  await UserRecord.create({
    userId: listing.sellerId,
    type: 'sell',
    targetId: buyer.userId,
    detail: `Sold ${listing.cardName} (${listing.cardCode}) for ${listing.price} Patterns to <@${interaction.user.id}>`
  });

  // Notify seller via DM
  try {
    const sellerUser = await interaction.client.users.fetch(listing.sellerId);
    await sellerUser.send(`Your card **${listing.cardName}** \`${listing.cardCode}\` has been purchased by <@${buyer.userId}> for **${listing.price} Patterns**!`);
  } catch (err) {
    console.warn('⚠️ Could not DM seller:', err.message);
  }

  // Remove listing
  await listing.deleteOne();

  await interaction.reply({
    content: `✅ You bought **${listing.cardName}** for **${listing.price} Patterns** from <@${listing.sellerId}>!`
  });
};