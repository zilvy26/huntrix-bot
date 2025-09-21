// scripts/migrateUserInventoryToItems.js
require('dotenv').config();
const mongoose = require('mongoose');

// Adjust these paths to match your project
const UserInventory = require('../models/UserInventory');
const InventoryItem = require('../models/InventoryItem');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // Make sure the critical unique index exists before bulk upserts
  await InventoryItem.collection.createIndex({ userId: 1, cardCode: 1 }, { unique: true });

  const cursor = UserInventory.find().lean().cursor();
  let users = 0, writes = 0;

  console.time('migration');
  for await (const inv of cursor) {
    users++;
    const userId = inv.userId;
    const cards = Array.isArray(inv.cards) ? inv.cards : [];
    if (!cards.length) continue;

    // Build bulk ops in chunks (safe for big inventories)
    const CHUNK = 500;
    for (let i = 0; i < cards.length; i += CHUNK) {
      const slice = cards.slice(i, i + CHUNK);
      const ops = slice.map(c => ({
        updateOne: {
          filter: { userId, cardCode: c.cardCode },
          update: { $inc: { quantity: c.quantity ?? 1 } },
          upsert: true
        }
      }));
      const res = await InventoryItem.bulkWrite(ops, { ordered: false });
      writes += (res.upsertedCount || 0) + (res.modifiedCount || 0) + (res.matchedCount || 0);
    }

    if (users % 50 === 0) {
      console.log(`Processed users: ${users} (writes so far ~${writes})`);
    }
  }
  console.timeEnd('migration');
  console.log(`Done. Users processed: ${users}. Approx writes: ${writes}.`);

  await mongoose.disconnect();
})().catch(err => {
  console.error(err);
  process.exit(1);
});