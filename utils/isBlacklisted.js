// utils/isBlacklisted.js
const Blacklist = require('../models/Blacklist');

module.exports = async function isBlacklisted(userId) {
  const user = await Blacklist.findOne({ userId });
  return user || null;
};