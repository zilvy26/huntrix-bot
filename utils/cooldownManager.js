const Cooldown = require('../models/Cooldown');

async function isOnCooldown(userId, commandName) {
  const record = await Cooldown.findOne({ userId, commandName });
  if (!record) return false;
  if (record.expiresAt > new Date()) return true;

  await record.deleteOne(); // Clean up expired cooldown
  return false;
}

async function getCooldownTime(userId, commandName) {
  const record = await Cooldown.findOne({ userId, commandName });
  return record ? Math.max(0, Math.ceil((record.expiresAt - Date.now()) / 1000)) : 0;
}

async function getCooldownTimestamp(userId, commandName) {
  const record = await Cooldown.findOne({ userId, commandName });
  return record ? `<t:${Math.floor(record.expiresAt.getTime() / 1000)}:R>` : null;
}

async function setCooldown(userId, commandName, durationMs) {
  const expiresAt = new Date(Date.now() + durationMs);
  await Cooldown.findOneAndUpdate(
    { userId, commandName },
    { expiresAt },
    { upsert: true }
  );
}

async function getCooldowns(userId) {
  const userCooldowns = await Cooldown.find({ userId });
  const cooldownMap = {};
  for (const cd of userCooldowns) {
    cooldownMap[cd.commandName] = cd.expiresAt;
  }
  return cooldownMap;
}

module.exports = {
  isOnCooldown,
  getCooldownTime,
  getCooldowns,
  getCooldownTimestamp,
  setCooldown
};