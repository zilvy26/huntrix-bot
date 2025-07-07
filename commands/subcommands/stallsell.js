const UserInventory = require('../../models/UserInventory');
const Card = require('../../models/Card');
const MarketListing = require('../../models/MarketListing');
const shortid = require('shortid');

module.exports = async function(interaction) {
  const userId = interaction.user.id;
  const inputCode = interaction.options.getString('cardcode');
  const cardCode = inputCode.toUpperCase().trim();
  const price = interaction.options.getInteger('price');

  

  if (price <= 0) {
    return interaction.reply({ content: 'Price must be greater than 0.' });
  }

  const listingCount = await MarketListing.countDocuments({ sellerId: userId });
  if (listingCount >= 50) {
    return interaction.reply({ content: 'You can only have 50 listings at a time.' });
  }

  const inventoryDoc = await UserInventory.findOne({ userId });
  

  if (!inventoryDoc) {
    return interaction.reply({ content: 'You have no inventory record.' });
  }

  const ownedCard = inventoryDoc.cards.find(c => c.cardCode.trim().toUpperCase() === cardCode);
  
  if (!ownedCard || ownedCard.quantity <= 0) {
    return interaction.reply({ content: `You do not own the card with code **${cardCode}**.` });
  }

  const cardData = await Card.findOne({ cardCode });
  if (!cardData) {
    return interaction.reply({ content: `Metadata for **${cardCode}** not found in card database.` });
  }

  const buyCode = shortid.generate().toUpperCase();
  const imageUrl = cardData.discordPermalinkImage || cardData.imgurImageLink;

  await MarketListing.create({
    cardCode: cardData.cardCode,
    cardName: cardData.name,
    group: cardData.group,
    era: cardData.era,
    rarity: cardData.rarity,
    imageUrl,
    price,
    sellerId: userId,
    sellerTag: `${interaction.user.username}#${interaction.user.discriminator}`,
    buyCode,
  });

  if (ownedCard.quantity > 1) {
    ownedCard.quantity -= 1;
  } else {
    inventoryDoc.cards = inventoryDoc.cards.filter(c => c.cardCode.trim().toUpperCase() !== cardCode);
  }

  await inventoryDoc.save();

  await interaction.reply({
    content: `<@${userId}> listed **${cardData.name}** for **${price} Patterns**!\n🛒 Buy Code: \`${buyCode}\``
  });
};