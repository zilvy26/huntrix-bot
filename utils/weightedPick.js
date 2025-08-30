// utils/weightedPick.js
function weightedPick(items, weights) {
  if (!items.length || !weights.length || items.length !== weights.length) return null;

  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return null;

  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= Math.max(0, weights[i]);
    if (roll < 0) return items[i];
  }
  return items[items.length - 1]; // fallback
}

module.exports = { weightedPick };