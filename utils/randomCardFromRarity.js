// utils/randomCardFromRarity.js
const { getGlobalPullConfig } = require('./globalPullConfig');
const { weightedPick } = require('./weightedPick');
const Card = require('../models/Card');

async function getRandomCardByRarity(rarity) {
  const cards = await Card.find({ rarity, pullable: true }).lean();
  if (!cards.length) return null;

  const cfg = getGlobalPullConfig();
  const { eraMultipliers, codeMultipliers, minWeight, maxWeight } = cfg;

  const weights = cards.map(c => {
    const eraKey = c.era ? String(c.era).toLowerCase() : '';
    const codeKey = c.cardCode ? String(c.cardCode).toLowerCase() : '';

    const mEra  = eraKey && eraMultipliers[eraKey] !== undefined ? eraMultipliers[eraKey] : 1;
    const mCode = codeKey && codeMultipliers[codeKey] !== undefined ? codeMultipliers[codeKey] : 1;

    const w = Math.min(maxWeight, Math.max(minWeight, 1 * mEra * mCode));
    return w;
  });

  const picked = weightedPick(cards, weights);
  if (!picked) return null;
  return await Card.findById(picked._id); // hydrate doc
}

module.exports = getRandomCardByRarity;