/**
 * Cleanup duplicate MarketListing buyCodes (GLOBAL uniqueness).
 * - Keep newest listing per buyCode
 * - Delete older duplicates
 * - Return deleted listings to seller inventory (InventoryItem +$inc: { quantity: 1 })
 *
 * Usage:
 *   DRY_RUN=1 node scripts/dedup-marketlistings-global.js   # preview only
 *   node scripts/dedup-marketlistings-global.js             # execute changes
 */
require('dotenv').config();
const mongoose = require('mongoose');

// ---- CONFIG -----------------------------------------------------------------
const DRY_RUN = true;

const MarketListing = require('../models/MarketListing');
const InventoryItem = require('../models/InventoryItem');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('🟢 Connected to MongoDB');
  console.log(DRY_RUN ? '🔎 DRY RUN: no writes will be performed.' : '✍️  LIVE RUN: will modify data.');

  const coll = mongoose.connection.db.collection('marketlistings');

  // 1) Find duplicate buyCodes
  const dupGroups = await coll.aggregate([
    { $group: {
        _id: "$buyCode",
        ids: { $push: "$_id" },
        count: { $sum: 1 },
        maxCreatedAt: { $max: "$createdAt" }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  if (!dupGroups.length) {
    console.log('✅ No duplicate buyCodes found. Ensuring index…');
    if (!DRY_RUN) await ensureIndexes();
    await mongoose.disconnect();
    console.log('🔌 Disconnected.');
    return;
  }

  console.log(`⚠️ Found ${dupGroups.length} duplicate buyCode group(s). Processing…`);

  let totalGroups = 0;
  let totalDeleted = 0;
  let totalReturned = 0;

  for (const g of dupGroups) {
    totalGroups += 1;

    // Load all docs for this buyCode, newest first
    const docs = await MarketListing.find({ buyCode: g._id })
      .select({ _id: 1, sellerId: 1, cardCode: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .lean();

    if (docs.length <= 1) continue; // race condition: now unique

    const [keep, ...toDelete] = docs; // keep newest
    if (!toDelete.length) continue;

    console.log(`• buyCode ${g._id}: keep ${keep._id}, delete ${toDelete.length}`);

    if (!DRY_RUN) {
      // 2) Return each deleted listing to seller inventory
      // Build bulk upserts per { userId, cardCode }
      const incOps = toDelete.map(d => ({
        updateOne: {
          filter: { userId: d.sellerId, cardCode: d.cardCode },
          update: { $inc: { quantity: 1 } },
          upsert: true
        }
      }));
      if (incOps.length) {
        const res = await InventoryItem.bulkWrite(incOps, { ordered: false });
        // Count the number we intended to return (equal to toDelete.length)
        totalReturned += toDelete.length;
      }

      // 3) Delete the duplicate listings
      const deleteIds = toDelete.map(d => d._id);
      const delRes = await MarketListing.deleteMany({ _id: { $in: deleteIds } });
      totalDeleted += delRes.deletedCount || 0;
    } else {
      // DRY RUN log
      for (const d of toDelete) {
        console.log(`  - would return cardCode=${d.cardCode} to seller=${d.sellerId} and delete listing _id=${d._id}`);
      }
    }
  }

  console.log(`\nSummary:`)
  console.log(`  Duplicate groups processed: ${totalGroups}`);
  console.log(`  Listings removed:           ${totalDeleted}${DRY_RUN ? ' (would remove)' : ''}`);
  console.log(`  Cards returned to sellers:  ${totalReturned}${DRY_RUN ? ' (would return)' : ''}`);

  // 4) Ensure the unique index on buyCode
  console.log('\nEnsuring unique index on buyCode…');
  if (!DRY_RUN) {
    await ensureIndexes();
    console.log('✅ Index synced.');
  } else {
    console.log('🔎 DRY RUN: skipping index sync.');
  }

  await mongoose.disconnect();
  console.log('🔌 Disconnected.');
}

async function ensureIndexes() {
  // Make sure your schema sets this:
  // marketListingSchema.index({ buyCode: 1 }, { unique: true });
  await MarketListing.syncIndexes();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
