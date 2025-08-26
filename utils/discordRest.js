// utils/discordRest.js
const { REST, Routes } = require('discord.js');

if (!process.env.DISCORD_TOKEN) {
  console.warn('[discordRest] DISCORD_TOKEN missing — REST calls will fail.');
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// --- Fetchers (if you ever need them) ---
async function fetchUser(userId) {
  return rest.get(Routes.user(userId)); // { id, username, global_name, ... }
}

async function fetchGuildMember(guildId, userId) {
  return rest.get(Routes.guildMember(guildId, userId)); // { user, roles: [...] }
}

// --- Senders ---
async function sendChannelMessage(channelId, data) {
  // data: { content?, embeds?, components?, files? }
  return rest.post(Routes.channelMessages(channelId), { body: data });
}

async function createDM(userId) {
  // returns { id: channelId }
  return rest.post(Routes.userChannels(), { body: { recipient_id: userId } });
}

async function sendDM(userId, data) {
  const { id: channelId } = await createDM(userId);
  return sendChannelMessage(channelId, data);
}

module.exports = {
  rest, Routes,
  fetchUser, fetchGuildMember,
  sendChannelMessage, sendDM, createDM
};