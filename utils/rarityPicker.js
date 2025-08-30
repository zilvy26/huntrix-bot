// utils/pickRarity.js
const { getGlobalPullConfig } = require('./globalPullConfig');
const parseRarity = require('./parseRarity'); // e.g. "3S" -> 3

async function pickRarity() {
  const cfg = getGlobalPullConfig();
  const entries = Object.entries(cfg.rarityWeights);

  const total = entries.reduce((s, [, w]) => s + Number(w || 0), 0);
  const roll = Math.random() * total;

  let acc = 0;
  for (const [label, w] of entries) {
    acc += Number(w || 0);
    if (roll < acc) return parseRarity(label);
  }
  return 1;
}

module.exports = pickRarity;