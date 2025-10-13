const { getGlobalPullConfig } = require('./globalPullConfig');
const { weightedPick } = require('./weightedPick');
const Card = require('../models/Card');

const ALWAYS_INCLUDED_CATEGORIES = ['zodiac', 'event', 'others'];

async function getRandomCardByRarity(rarity, preferredCategories = []) {
  const categories = preferredCategories.length
    ? [...new Set([...preferredCategories, ...ALWAYS_INCLUDED_CATEGORIES])]
    : []; // empty = pull from all

  const filter = {
    rarity,
    pullable: true,
    ...(categories.length ? { category: { $in: categories } } : {})
  };

  const cards = await Card.find(filter).lean();
  if (!cards.length) return null;

  const cfg = getGlobalPullConfig();
  const { eraMultipliers, codeMultipliers, minWeight, maxWeight } = cfg;

  const weights = cards.map(c => {
    const eraKey = c.era ? String(c.era).toLowerCase() : '';
    const codeKey = c.cardCode ? String(c.cardCode).toLowerCase() : '';

    const mEra = eraKey && eraMultipliers[eraKey] !== undefined ? eraMultipliers[eraKey] : 1;
    const mCode = codeKey && codeMultipliers[codeKey] !== undefined ? codeMultipliers[codeKey] : 1;

    return Math.min(maxWeight, Math.max(minWeight, 1 * mEra * mCode));
  });

  const picked = weightedPick(cards, weights);
  if (!picked) return null;
  return await Card.findById(picked._id);
}

module.exports = getRandomCardByRarity;
