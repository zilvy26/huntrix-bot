// utils/remoteInteraction.js
const { WebhookClient } = require('discord.js');
const { buildOptionsProxy } = require('./optionsProxy');

const EPH_FLAG = 1 << 6;

function createRemoteInteraction({ appId, token, channelId, guildId, optionsSnap }) {
  const wh = new WebhookClient({ id: appId, token });

  const base = {
    applicationId: appId,
    channelId,
    guildId: guildId ?? null,
    guild: guildId ? { id: guildId } : null,

    // ⚡️ Add these shims so cooldownManager works:
    inGuild() { return !!this.guildId; },
    inCachedGuild() { return !!this.guildId; },

    // Discord.js marks these as true after an ACK
    replied: true,
    deferred: true,
    isRepliable: () => true,

    async followUp(data = {}) {
      const { ephemeral, ...rest } = data;
      const flags = ephemeral ? EPH_FLAG : rest.flags;
      return wh.send({ flags, ...rest });
    },
    async editReply(data = {}) {
      const { ephemeral, ...rest } = data;
      const flags = ephemeral ? EPH_FLAG : rest.flags;
      return wh.send({ flags, ...rest });
    },
    channel: { send: (data) => wh.send(data) },

    options: buildOptionsProxy(optionsSnap || { subcommand: null, subcommandGroup: null, byName: {} }),
  };

  return base;
}

module.exports = { createRemoteInteraction };