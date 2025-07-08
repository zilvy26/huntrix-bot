const parseRarity = require('./parseRarity'); // we'll use the parser too

// These can stay in "label" form for config, but will be converted
const rawRarities = {
  '1S': 39,
  '2S': 28,
  '3S': 21.25,
  '4S': 11.25,
  '5S': 0.50,
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