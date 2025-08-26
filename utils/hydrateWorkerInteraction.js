// utils/hydrateWorkerInteraction.js
const { REST, Routes } = require('discord.js');
const getOrCreateUser = require('./getOrCreateUser'); // your existing util

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

// create a d.js-like roles cache with .has()
function makeRolesCache(roleIds = []) {
  const set = new Set(roleIds);
  return {
    has: (id) => set.has(id),
    // minimal surface for code that iterates
    forEach: (fn) => { for (const id of set) fn({ id }, id); },
    get size() { return set.size; }
  };
}

async function hydrateGuildMember(interaction) {
  if (!interaction.guildId || !interaction.user?.id) return null;
  try {
    const data = await rest.get(Routes.guildMember(interaction.guildId, interaction.user.id));
    // data.roles is an array of role IDs
    const cache = makeRolesCache(Array.isArray(data.roles) ? data.roles : []);
    interaction.member = interaction.member || {};
    interaction.member.user = interaction.user;
    interaction.member.roles = { cache };
    return interaction.member;
  } catch (e) {
    // Not fatal; just means roles checks will be false
    interaction.member = interaction.member || {};
    interaction.member.user = interaction.user;
    interaction.member.roles = { cache: makeRolesCache([]) };
    return interaction.member;
  }
}

function addShims(interaction) {
  if (!interaction.inGuild) interaction.inGuild = function () { return !!this.guildId; };
  if (!interaction.inCachedGuild) interaction.inCachedGuild = function () { return !!this.guildId; };
  if (!interaction.isRepliable) interaction.isRepliable = () => true;
}

async function hydrateWorkerInteraction(interaction) {
  addShims(interaction);

  // userData for commands that read preferences / balances, etc.
  try {
    interaction.userData = await getOrCreateUser(interaction);
  } catch (e) {
    // Leave undefined; commands should still guard with ?. if needed
    console.warn('[hydrate] getOrCreateUser failed:', e?.message || e);
  }

  // member.roles.cache.has(...) support via REST
  await hydrateGuildMember(interaction);

  return interaction;
}

module.exports = { hydrateWorkerInteraction };