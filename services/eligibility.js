// services/eligibility.js
const Card = require('../models/Card');
const InventoryItem = require('../models/InventoryItem'); // ⬅️ swapped in

/**
 * true if user owns EVERY card in eraKey (quantity > 0)
 */
async function hasCompleteEra(userId, eraKey) {
  // 1) Pull required codes for the era
  const required = await Card.find(
    { era: eraKey },
    { _id: 0, cardCode: 1 }
  ).lean();

  if (!required.length) return false;

  // Normalize to uppercase for consistent matching
  const need = new Set(required.map(c => String(c.cardCode).toUpperCase()));
  const needArr = [...need];

  // 2) From InventoryItem, get which of those codes the user actually owns (>0 qty)
  //    Using distinct avoids duplicates and minimizes payload.
  const ownedCodes = await InventoryItem.distinct('cardCode', {
    userId,
    cardCode: { $in: needArr },
    quantity: { $gt: 0 }
  });

  const owned = new Set(ownedCodes.map(cc => String(cc).toUpperCase()));

  // 3) Ensure every required code is owned
  for (const cc of need) {
    if (!owned.has(cc)) return false;
  }
  return true;
}

module.exports = { hasCompleteEra };