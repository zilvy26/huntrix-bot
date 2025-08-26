// utils/remoteInteraction.js
const { WebhookClient } = require('discord.js');
const { buildOptionsProxy } = require('./optionsProxy');

const EPH_FLAG = 1 << 6;

function createRemoteInteraction({ appId, token, channelId, optionsSnap }) {
  const wh = new WebhookClient({ id: appId, token });

  const base = {
    channelId,
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

    // Slash-command option getters
    options: buildOptionsProxy(optionsSnap || { subcommand: null, subcommandGroup: null, byName: {} })
  };

  return base;
}

module.exports = { createRemoteInteraction };