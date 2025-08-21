const UserInventory = require('../../../models/UserInventory');
const Card = require('../../../models/Card');
const MarketListing = require('../../../models/MarketListing');
const safeReply = require('../../../utils/safeReply');
const shortid = require('shortid');

module.exports = async function(interaction) {
  const userId = interaction.user.id;
  const inputCode = interaction.options.getString('cardcode');
  const cardCode = inputCode.toUpperCase().trim();
  const price = interaction.options.getInteger('price');

  

  if (price <= 0) {
    return safeReply(interaction, { content: 'Price must be greater than 0.' });
  }

  const listingCount = await MarketListing.countDocuments({ sellerId: userId });
  if (listingCount >= 50) {
    return safeReply(interaction, { content: 'You can only have 50 listings at a time.' });
  }

  const inventoryDoc = await UserInventory.findOne({ userId });
  

  if (!inventoryDoc) {
    return safeReply(interaction, { content: 'You have no inventory record.' });
  }

  const ownedCard = inventoryDoc.cards.find(c => c.cardCode.trim().toUpperCase() === cardCode);
  
  if (!ownedCard || ownedCard.quantity <= 0) {
    return safeReply(interaction, { content: `You do not own the card with code **${cardCode}**.` });
  }

  const cardData = await Card.findOne({ cardCode });

  const priceCaps = {
  1: 300,
  2: 600,
  3: 900,
  4: 1200
};

const isSpecialRarity5 = cardData.rarity === 5 && ['kpop', 'anime', 'game'].includes((cardData.category || '').toLowerCase());

if (cardData.rarity < 5 && price > priceCaps[cardData.rarity]) {
  return safeReply(interaction, {
    content: `Price cap for rarity ${cardData.rarity} cards is **${priceCaps[cardData.rarity]}** <:ehx_patterns:1389584144895315978>.`
  });
}

if (isSpecialRarity5 && price > 5000) {
  return safeReply(interaction, {
    content: `5 Star Standard cards are capped at **3000** <:ehx_patterns:1389584144895315978>.`
  });
}

  if (!cardData) {
    return safeReply(interaction, { content: `Metadata for **${cardCode}** not found in card database.` });
  }

  const buyCode = shortid.generate().toUpperCase();
  const imageUrl = cardData.discordPermalinkImage || cardData.imgurImageLink;

  await MarketListing.create({
    cardCode: cardData.cardCode,
    cardName: cardData.name,
    group: cardData.group,
    era: cardData.era,
    emoji: cardData.emoji,
    rarity: cardData.rarity,
    localImagePath: cardData.localImagePath,
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

  await safeReply(interaction, {
    content: `<@${userId}> listed **${cardData.name}** \`${cardData.cardCode}\` for **${price} <:ehx_patterns:1389584144895315978>**!\n Buy Code: \`${buyCode}\``
  });
};