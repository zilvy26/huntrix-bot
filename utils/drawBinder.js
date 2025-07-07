const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const UserInventory = require('../models/UserInventory');
const getCardImage = require('./getCardImage');

const SLOT_COORDS = [
  { x: 158, y: 50 },  { x: 490, y: 50 },  { x: 158, y: 506 },  { x: 490, y: 506 },
  { x: 998, y: 50 }, { x: 1330, y: 50 }, { x: 997, y: 503 }, { x: 1328, y: 503 }
];

module.exports = async function drawBinder(userId, page = 1) {
  const inventory = await UserInventory.findOne({ userId });
  if (!inventory) throw new Error('UserInventory not found.');

  const pageIndex = page - 1;
  if (pageIndex < 0 || pageIndex > 2) throw new Error('Invalid page number.');

  // Ensure binder is initialized with 3 pages of 8 slots
  inventory.binder = inventory.binder ?? [];
  while (inventory.binder.length < 3) inventory.binder.push([]);
  for (let i = 0; i < 3; i++) {
    while (inventory.binder[i].length < 8) inventory.binder[i].push(null);
  }

  const slots = inventory.binder[pageIndex];

  const canvas = createCanvas(1833, 992);
  const ctx = canvas.getContext('2d');

  const background = await loadImage(path.join(__dirname, '../assets/binder_base.png'));
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 8; i++) {
    const cardCode = slots[i];
    
    if (!cardCode) continue;

    try {
      const cardImage = await getCardImage(cardCode);
      const { x, y } = SLOT_COORDS[i];
      ctx.drawImage(cardImage, x, y, 341, 413);
    } catch (err) {
      console.warn(`❌ Failed to render card ${cardCode} at slot ${i + 1}: ${err.message}`);
    }
  }

  const finalBuffer = canvas.toBuffer('image/png');

// Optional: Help garbage collection
canvas.width = 0;
canvas.height = 0;

// Free card images if needed
for (let i = 0; i < 8; i++) {
  if (slots[i]) {
    slots[i] = null;
  }
}

// Force GC if available
global.gc?.();

return finalBuffer;
};