// utils/cooldownManager.js
const fs = require('fs');
const path = require('path');

const cooldownFile = path.join(__dirname, '../data/cooldowns.json');
let cooldowns = {};

// Load from file
if (fs.existsSync(cooldownFile)) {
  cooldowns = JSON.parse(fs.readFileSync(cooldownFile, 'utf8'));
}

// Save to file
function saveCooldowns() {
  fs.writeFileSync(cooldownFile, JSON.stringify(cooldowns, null, 2));
}

function isOnCooldown(userId, commandName) {
  const now = Date.now();
  if (!cooldowns[commandName]) return false;
  const expires = cooldowns[commandName][userId];
  return expires && now < expires;
}

function getCooldownTime(userId, commandName) {
  const now = Date.now();
  const expires = cooldowns[commandName]?.[userId];
  return expires ? Math.ceil((expires - now) / 1000) : 0;
}

function setCooldown(userId, commandName, durationMs) {
  if (!cooldowns[commandName]) cooldowns[commandName] = {};
  cooldowns[commandName][userId] = Date.now() + durationMs;
  saveCooldowns();
}

module.exports = {
  isOnCooldown,
  getCooldownTime,
  setCooldown
};