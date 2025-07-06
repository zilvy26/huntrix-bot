const { createCanvas, loadImage } = require('canvas');

async function safeLoadImage(url) {
  try {
    return await loadImage(url);
  } catch (err) {
    console.warn('⚠️ Failed to load image:', url, err.message);
    return await loadImage('https://imgur.com/gallery/blank-transparent-png-Y1x2s41'); // ← set to your fallback image
  }
}

module.exports = async function renderStallPreview(listings) {
  const width = 800;
  const height = 1050;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, width, height);

  const cardWidth = 720;
  const cardHeight = 320;
  const spacing = 30;

  for (let i = 0; i < listings.length; i++) {
    const card = listings[i];
    const y = i * (cardHeight + spacing) + 20;

    const imageUrl = card.imageUrl || card.discordPermalinkImage || card.imgurImageLink;
    const img = await safeLoadImage(imageUrl);
    ctx.drawImage(img, 40, y, cardWidth, cardHeight);
  }

  return canvas.toBuffer();
};