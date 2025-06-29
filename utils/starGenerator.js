/**
 * Generate a star rating string with custom emoji.
 * 
 * @param {object} options
 * @param {number|string} options.rarity - Accepts 0–5, "3", "3S", etc.
 * @param {string} [options.overrideEmoji] - Emoji used for full stars (optional).
 * @returns {string}
 */
module.exports = function generateStars({ rarity = 0, overrideEmoji }) {
  const full = overrideEmoji || '<:fullstar:1387609456824680528>';
  const blank = '<:blankstar:1387609460385779792>';

  let value = 0;

  if (typeof rarity === 'string') {
    const match = rarity.match(/^(\d)/); // handles "3" or "3S"
    if (match) value = parseInt(match[1]);
  } else if (typeof rarity === 'number') {
    value = rarity;
  }

  const clamped = Math.max(0, Math.min(5, value));
  return full.repeat(clamped) + blank.repeat(5 - clamped);
};