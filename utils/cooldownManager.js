const Cooldown = require('../models/Cooldown');
const cooldownConfig = require('../utils/cooldownConfig');

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

async function getEffectiveCooldown(interaction, commandName) {
  const config = cooldownConfig[commandName];
  if (!config) return 0;

  const duration = typeof config === 'object' ? config.default : config;
  const reductions = typeof config === 'object' ? config.reductions || [] : [];

  let totalReduction = 0;

  // ✅ Safe guard to support DMs
  if (interaction.inGuild() && interaction.member?.roles?.cache) {
    for (const { id, percent } of reductions) {
      if (interaction.member.roles.cache.has(id)) {
        totalReduction += percent;
      }
    }
  }

  const cap = 70;
  totalReduction = Math.min(totalReduction, cap);

  return Math.floor(duration * (1 - totalReduction / 100));
}

module.exports = {
  isOnCooldown,
  getCooldownTime,
  getCooldowns,
  getCooldownTimestamp,
  setCooldown,
  getEffectiveCooldown // 🔥 added
};