// utils/cooldownManager.js
const fs = require('fs');
const path = require('path');

const cooldownFile = path.join(__dirname, '../data/cooldowns.json');
let cooldowns = {};

// Load cooldowns from file
if (fs.existsSync(cooldownFile)) {
  try {
    cooldowns = JSON.parse(fs.readFileSync(cooldownFile));
  } catch (err) {
    console.error('❌ Failed to parse cooldowns.json:', err);
  }
}

// Persist cooldowns to file
function saveCooldowns() {
  try {
    fs.writeFileSync(cooldownFile, JSON.stringify(cooldowns, null, 2));
  } catch (err) {
    console.error('❌ Failed to save cooldowns.json:', err);
  }
}

// Check if user is on cooldown
function isOnCooldown(userId, commandName) {
  const now = Date.now();
  if (!cooldowns[commandName]) return false;
  const expires = cooldowns[commandName][userId];
  return expires && now < expires;
}

// Get remaining cooldown time in seconds
function getCooldownTime(userId, commandName) {
  const now = Date.now();
  const expires = cooldowns[commandName]?.[userId];
  return expires ? Math.ceil((expires - now) / 1000) : 0;
}

// Get Discord timestamp format for when cooldown ends
function getCooldownTimestamp(userId, commandName) {
  const expires = cooldowns[commandName]?.[userId];
  if (!expires) return null;
  const seconds = Math.floor(expires / 1000); // Convert ms to seconds
  return `<t:${seconds}:R>`;
}

// Set new cooldown
function setCooldown(userId, commandName, durationMs) {
  if (!cooldowns[commandName]) cooldowns[commandName] = {};
  cooldowns[commandName][userId] = Date.now() + durationMs;
  saveCooldowns();
}

module.exports = {
  isOnCooldown,
  getCooldownTime,
  getCooldownTimestamp,
  cooldowns,
  setCooldown
};