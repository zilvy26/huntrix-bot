// utils/randomCardFromRarity.js

const Card = require('../models/Card');

/**
 * Pull a random card by rarity and pullable filter
 * @param {string} rarity 
 * @returns {Promise<Object>} A single card document
 */
async function getRandomCardByRarity(rarity) {
  const cards = await Card.find({ rarity, pullable: true });
  if (!cards.length) return null;
  const random = Math.floor(Math.random() * cards.length);
  return cards[random];
}

module.exports = getRandomCardByRarity;