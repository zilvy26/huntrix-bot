// utils/parseRarity.js
module.exports = function parseRarity(value) {
  if (typeof value === 'string' && value.endsWith('S')) {
    return parseInt(value[0]); // "3S" → 3
  }
  return Number(value); // handle numbers directly
};