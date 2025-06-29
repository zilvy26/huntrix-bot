/**
 * Generate a star rating string with custom emoji.
 * 
 * @param {number|string} score - Number of full stars (0–5). Accepts "3S" or just 3.
 * @param {string} fullEmoji - The emoji used for full stars.
 * @param {string} blankEmoji - The emoji used for empty stars.
 * @returns {string} A string of 5 emojis (e.g. ⭐⭐⭐☆☆)
 */
module.exports = function generateStarRating(score = 0, fullEmoji = '<:fullstar:1387609456824680528>', blankEmoji = '<:blankstar:1387609460385779792>') {
  // Support formats like "4S" or 3
  let value = typeof score === 'string' ? parseInt(score[0]) : parseInt(score);
  if (isNaN(value)) value = 0;
  const clamped = Math.max(0, Math.min(5, value)); // Clamp to 0–5

  return fullEmoji.repeat(clamped) + blankEmoji.repeat(5 - clamped);
};