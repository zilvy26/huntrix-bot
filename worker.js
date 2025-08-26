// worker.js (replace the whole file)
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const glob = require('glob');
const { Collection } = require('discord.js');
const { Worker } = require('bullmq');
const { createRemoteInteraction } = require('./utils/remoteInteraction');

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_TLS === '1' ? {} : undefined
};

// ---- Load commands from your folders ----
const commands = new Collection();

function loadCommands() {
  const patterns = [
    path.join(__dirname, 'commands/global/**/*.js'),
    path.join(__dirname, 'commands/guild-only/**/*.js'),
    // keep these to be flexible with future refactors:
    path.join(__dirname, 'src/commands/global/**/*.js'),
    path.join(__dirname, 'src/commands/guild-only/**/*.js'),
  ];

  const files = Array.from(new Set(patterns.flatMap(p => glob.sync(p, { nodir: true }))));

  console.log(`[worker] scanning ${files.length} files...`);

  let loaded = 0;
  for (const file of files) {
    try {
      const mod = require(file);
      const name = mod?.data?.name || mod?.name || path.parse(file).name;
      if (!name || typeof mod.execute !== 'function') continue;

      commands.set(name, mod);
      if (Array.isArray(mod.aliases)) {
        for (const a of mod.aliases) commands.set(a, mod);
      }
      loaded++;
    } catch (e) {
      console.warn(`[worker] failed to load ${path.relative(__dirname, file)}: ${e.message}`);
    }
  }

  console.log(`[worker] loaded ${loaded} modules. Commands: ${Array.from(commands.keys()).join(', ') || '(none)'}`);
}

loadCommands();

// ---- Job worker ----
new Worker('huntrix-jobs', async (job) => {
  const d = job.data;
  console.log(`[worker] job -> /${d.command} user=${d.userId}`);

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