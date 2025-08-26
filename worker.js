require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { Collection } = require('discord.js');
const { Worker } = require('bullmq');
const { createRemoteInteraction } = require('./src/utils/remoteInteraction');

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_TLS === '1' ? {} : undefined
};

// Load your command modules
const commands = new Collection();
const base = path.join(__dirname, 'src/commands');
for (const folder of ['global', 'guild-only']) {
  const dir = path.join(base, folder);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const mod = require(path.join(dir, file));
    const name = mod.data?.name || path.parse(file).name;
    commands.set(name, mod);
  }
}

new Worker('huntrix-jobs', async (job) => {
  const d = job.data;

  const interaction = Object.assign(
    createRemoteInteraction({
      appId: d.appId,
      token: d.token,
      channelId: d.channelId,
      optionsSnap: d.optionsSnap
    }),
    {
      commandName: d.command,
      user: { id: d.userId },
      guildId: d.guildId,
      isChatInputCommand: () => true
    }
  );

  const cmd = commands.get(d.command);
  if (!cmd || typeof cmd.execute !== 'function') {
    return interaction.followUp({ content: `⚠️ Command "${d.command}" not found.` });
  }

  await cmd.execute(interaction);
}, { connection, concurrency: Number(process.env.WORKER_CONCURRENCY || 4) });

console.log('🛠️ Worker online.');