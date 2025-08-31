// services/eligibility.js
const Card = require('../models/Card');
const UserInventory = require('../models/UserInventory');

/** true if user owns EVERY card in eraKey */
async function hasCompleteEra(userId, eraKey) {
  const required = await Card.find({ era: eraKey }, { _id: 0, cardCode: 1 }).lean();
  if (!required.length) return false;
  const need = new Set(required.map(c => String(c.cardCode).toUpperCase()));
  const ownedDoc = await UserInventory.findOne(
    { userId, 'cards.cardCode': { $in: [...need] } },
    { 'cards.cardCode': 1, _id: 0 }
  ).lean();
  const owned = new Set((ownedDoc?.cards || []).map(c => String(c.cardCode).toUpperCase()));
  for (const cc of need) if (!owned.has(cc)) return false;
  return true;
}

module.exports = { hasCompleteEra };
