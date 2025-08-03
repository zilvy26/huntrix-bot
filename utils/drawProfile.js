const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const templateOptions = require('../data/templateOptions');
const wrapText = require('./wrapText'); // Ensure this exists

module.exports = async function drawProfile(user, userProfile, favoriteCardImageURL) {
  const canvas = createCanvas(1557, 1080);
  const ctx = canvas.getContext('2d');

  // === Load Background Template ===
  const templateId = userProfile.template || 'profile_base';
  const selectedTemplate = templateOptions.find(t => t.id === templateId);
  const filename = selectedTemplate?.file || 'profile_base.png';
  const templatePath = path.join(__dirname, '../assets/templates/', filename);
  const background = await loadImage(templatePath);
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

  // === Draw Avatar ===
  const avatar = await loadImage(user.displayAvatarURL({ extension: 'png', size: 256 }));
  const avatarX = 119, avatarY = 218, avatarSize = 122;
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
  ctx.restore();

  // === Username ===
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#2f1b39';
  ctx.fillText(`${user.username}#${user.discriminator}`, 400, 225);

  // === Patterns Count ===
  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#2f1b39';
  ctx.fillText(userProfile.patterns?.toLocaleString() || '0', 345, 277);

  // === Sopop Count ===
  ctx.fillText(userProfile.sopop?.toLocaleString() || '0', 515, 277);

  // === Bio ===
  ctx.fillStyle = '#2f1b39';
  const bioX = 120, bioY = 470, maxWidth = 1350;
  ctx.font = '22x sans-serif';
  const bioLines = wrapText(ctx, userProfile.aboutMe || 'No bio set.', maxWidth);
  bioLines.forEach((line, i) => {
    ctx.fillText(line, bioX, bioY + i * 34);
  });

  // === Favorite Card ===
  if (favoriteCardImageURL) {
  try {
    let cardImage;

    if (favoriteCardImageURL.startsWith('http')) {
      const response = await fetch(favoriteCardImageURL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; HuntrixBot/1.0; +https://github.com/your-repo)'
        }
      });

      if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
      const contentType = response.headers.get('content-type');
      if (!contentType?.startsWith('image/')) throw new Error(`Unsupported image type: ${contentType}`);

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      cardImage = await loadImage(buffer);
    } else {
      cardImage = await loadImage(favoriteCardImageURL); // local path
    }

    ctx.drawImage(cardImage, 890, 194, 500, 735);

  } catch (err) {
    console.warn('⚠️ Failed to load favorite card image:', err.message);
  }
}

  const finalBuffer = canvas.toBuffer();

// Optional: help GC by clearing large vars
canvas.width = 0;
canvas.height = 0;

// Optional cleanup

return finalBuffer;
};