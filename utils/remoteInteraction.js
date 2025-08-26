// utils/remoteInteraction.js
const { WebhookClient } = require('discord.js');
const { buildOptionsProxy } = require('./optionsProxy');

const EPH_FLAG = 1 << 6;

function createRemoteInteraction({ appId, token, channelId, guildId, optionsSnap, userSnap }) {
  const wh = new WebhookClient({ id: appId, token });

  return {
    applicationId: appId,
    channelId,
    guildId: guildId ?? null,
    guild: guildId ? { id: guildId } : null,
    user: userSnap || { id: '0' },

    // d.js helpers your utils expect
    inGuild() { return !!this.guildId; },
    inCachedGuild() { return !!this.guildId; },
    isRepliable: () => true,

    // reflect "already deferred": first send should EDIT
    deferred: true,
    replied: false,

    // ✅ EDIT the original interaction response (single message)
    async editReply(data = {}) {
      const { ephemeral, ...rest } = data;
      const flags = ephemeral ? EPH_FLAG : rest.flags;
      return wh.editMessage('@original', { flags, ...rest });
    },

    // New messages
    async followUp(data = {}) {
      const { ephemeral, ...rest } = data;
      const flags = ephemeral ? EPH_FLAG : rest.flags;
      return wh.send({ flags, ...rest });
    },

    // Optional helper for code that calls fetchReply()
    async fetchReply() {
      try { return await wh.fetchMessage('@original'); } catch { return null; }
    },

    channel: { send: (data) => wh.send(data) },
    options: buildOptionsProxy(optionsSnap || { subcommand:null, subcommandGroup:null, byName:{} }),
  };
}

module.exports = { createRemoteInteraction };