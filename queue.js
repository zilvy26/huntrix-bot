// queue.js
const { Queue } = require('bullmq');

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_TLS === '1' ? {} : undefined
};

const q = new Queue('huntrix-jobs', { connection });

function snapshotOptions(interaction) {
  const root = { subcommandGroup: null, subcommand: null, byName: {} };
  try { root.subcommandGroup = interaction.options.getSubcommandGroup(false); } catch {}
  try { root.subcommand     = interaction.options.getSubcommand(false); } catch {}

  const TYPE = { SUB_COMMAND:1, SUB_COMMAND_GROUP:2, STRING:3, INTEGER:4, BOOLEAN:5, USER:6, CHANNEL:7, ROLE:8, MENTIONABLE:9, NUMBER:10, ATTACHMENT:11 };

  function walk(list = []) {
    for (const opt of list) {
      if (opt.type === TYPE.SUB_COMMAND_GROUP || opt.type === TYPE.SUB_COMMAND) { walk(opt.options || []); continue; }
      const entry = { type: opt.type, value: opt.value ?? null };
      try {
        if (opt.type === TYPE.USER) {
          const u = interaction.options.getUser(opt.name, false);
          if (u) entry.resolved = { user: { id: u.id, username: u.username, globalName: u.globalName ?? null } };
        } else if (opt.type === TYPE.CHANNEL) {
          const c = interaction.options.getChannel(opt.name, false);
          if (c) entry.resolved = { channel: { id: c.id, type: c.type, name: c.name ?? null } };
        } else if (opt.type === TYPE.ROLE) {
          const r = interaction.options.getRole(opt.name, false);
          if (r) entry.resolved = { role: { id: r.id, name: r.name } };
        } else if (opt.type === TYPE.ATTACHMENT) {
          const a = interaction.options.getAttachment(opt.name, false);
          if (a) entry.resolved = { attachment: { id: a.id, name: a.name, size: a.size, contentType: a.contentType ?? null, url: a.url } };
        }
      } catch {}
      root.byName[opt.name] = entry;
    }
  }
  walk(interaction.options?.data || []);
  return root;
}

async function enqueueInteraction(interaction, extra = {}) {
  const payload = {
    appId: interaction.applicationId,
    token: interaction.token,
    userId: interaction.user.id,
    user: {
      id: interaction.user.id,
      username: interaction.user.username ?? null,
      globalName: interaction.user.globalName ?? null,
      discriminator: interaction.user.discriminator ?? null
    },
    channelId: interaction.channelId,
    guildId: interaction.guildId ?? null,
    command: interaction.commandName,
    optionsSnap: snapshotOptions(interaction),
    isComponent: interaction.isButton?.() || interaction.isStringSelectMenu?.(),
    customId: interaction.customId ?? null,
    extra
  };

  return q.add('run', payload, { attempts: 2, removeOnComplete: 500, removeOnFail: 200 });
}

module.exports = { enqueueInteraction };