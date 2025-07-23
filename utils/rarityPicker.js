const parseRarity = require('./parseRarity'); // we'll use the parser too

// These can stay in "label" form for config, but will be converted
const rawRarities = {
  '1S': 37,
  '2S': 28.75,
  '3S': 20.25,
  '4S': 11.5,
  '5S': 2.5,
};

/**
 * Picks a numeric rarity value (1–5) based on weights.
 * @returns {number} Rarity number (e.g. 3)
 */
function pickRarity() {
  const total = Object.values(rawRarities).reduce((a, b) => a + b, 0);
  const roll = Math.random() * total;
  let sum = 0;

  for (const [rarityLabel, weight] of Object.entries(rawRarities)) {
    sum += weight;
    if (roll < sum) {
      return parseRarity(rarityLabel); // "3S" → 3
    }
  }

  return 1; // fallback
}

module.exports = pickRarity;