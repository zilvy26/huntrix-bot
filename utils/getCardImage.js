const { loadImage } = require('canvas');
const Card = require('../models/Card');

module.exports = async function getCardImage(cardCode) {
  const card = await Card.findOne({ cardCode });

  if (!card || !card.imgurImageLink) {
    throw new Error(`Card image missing for ${cardCode}`);
  }

  return loadImage(card.imgurImageLink);
};