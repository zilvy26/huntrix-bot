const User = require('../models/User');

/**
 * Add currency to a user.
 * @param {string} userId - Discord user ID
 * @param {object} options - { patterns?: number, sopop?: number }
 * @returns {Promise<object>} - The updated user document
 */
async function giveCurrency(userId, { patterns = 0, sopop = 0 }) {
  const user = await User.findOneAndUpdate(
    { userId },
    {
      $inc: {
        patterns,
        sopop,
      }
    },
    { new: true, upsert: true }
  );

  return user;
}

module.exports = giveCurrency;