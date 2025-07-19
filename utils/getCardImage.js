const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

module.exports = async function getCardImage(cardId) {
  const imagePath = `/var/cards/${cardId}.png`;

  try {
    if (!fs.existsSync(imagePath)) {
      throw new Error('Card image not found.');
    }
    return await loadImage(imagePath);
  } catch (err) {
    console.error(`Failed to load image for card ${cardId}:`, err);
    // Optionally return a fallback image
    return null;
  }
};