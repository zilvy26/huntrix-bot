// worker.js
require('dotenv').config();

const path = require('path');
const glob = require('glob');
const { Collection } = require('discord.js');
const { Worker } = require('bullmq');
const mongoose = require('mongoose');
const { createRemoteInteraction } = require('./utils/remoteInteraction');
const { hydrateWorkerInteraction } = require('./utils/hydrateWorkerInteraction');
const { startReminderPoller } = require('./utils/reminderPoller');

function preloadModels() {
  const files = glob.sync(path.join(__dirname, 'models/**/*.js'), { nodir: true });
  let ok = 0;
  for (const f of files) {
    try { require(f); ok++; }
    catch (e) { console.warn(`[worker] model load failed ${path.relative(__dirname, f)}: ${e.message}`); }
  }
  console.log(`[worker] preloaded ${ok}/${files.length} model files`);
}
preloadModels();

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.MONGO_DB || undefined,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });
    console.log('🗄️  Worker connected to MongoDB');

    // 🔽 ensure indexes for models you care about
    const InventoryItem = require('./models/InventoryItem');
    await InventoryItem.syncIndexes();
    console.log('✅ Worker synced InventoryItem indexes');

    // You can add others too if needed
    // const UserRecord = require('./models/UserRecord');
    // await UserRecord.syncIndexes();

  } catch (e) {
    console.error('❌ Worker MongoDB connect error:', e.message);
  }
})();

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_TLS === '1' ? {} : undefined,
};

const commands = new Collection();
function loadCommands() {
  const patterns = [
    path.join(__dirname, 'commands/global/**/*.js'),
    path.join(__dirname, 'commands/guild-only/**/*.js'),
    path.join(__dirname, 'src/commands/global/**/*.js'),
    path.join(__dirname, 'src/commands/guild-only/**/*.js'),
  ];

  const files = Array.from(new Set(patterns.flatMap((p) => glob.sync(p, { nodir: true }))));

  console.log(`[worker] scanning ${files.length} files...`);

  let loaded = 0;
  for (const file of files) {
    try {
      const mod = require(file);
      const name = (mod?.data?.name || mod?.name || path.parse(file).name || '').toLowerCase();
      if (!name || typeof mod.execute !== 'function') continue;

      commands.set(name, mod);
      if (Array.isArray(mod.aliases)) {
        for (const a of mod.aliases) commands.set(String(a).toLowerCase(), mod);
      }
      loaded++;
    } catch (e) {
      console.warn(`[worker] failed to load ${path.relative(__dirname, file)}: ${e.message}`);
    }
  }

  console.log(
    `[worker] loaded ${loaded} modules. Commands: ${Array.from(commands.keys()).join(', ') || '(none)'}`
  );
}
loadCommands();

new Worker(
  'huntrix-jobs',
  async (job) => {
    const d = job.data;
    console.log(`[worker] job -> /${d.command} user=${d.userId}`);

    const interaction = Object.assign(
      createRemoteInteraction({
        appId: d.appId,
        token: d.token,
        channelId: d.channelId,
        guildId: d.guildId,
        optionsSnap: d.optionsSnap,
        userSnap: d.user, // ✅ pass user to fix “Requested by undefined”
      }),
      {
        commandName: d.command,
        user: d.user || { id: d.userId },
        guildId: d.guildId,
        isChatInputCommand: () => true,
      }
    );

    const key = String(d.command || '').toLowerCase();
    const cmd = commands.get(key);

    if (!cmd || typeof cmd.execute !== 'function') {
      return interaction.followUp({ content: `⚠️ Command "${d.command}" not found.` });
    }

    try {
      await hydrateWorkerInteraction(interaction);
      await cmd.execute(interaction);
    } catch (err) {
      console.error(`[worker] error in /${d.command}:`, err);
      await interaction.followUp({
        content: `❌ Error in \`/${d.command}\`: ${err?.message || 'unknown error'}`,
        ephemeral: true,
      });
    }
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY || 4) }
);

process.on('unhandledRejection', (e) => console.error('UNHANDLED REJECTION:', e));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));

console.log('🛠️ Worker online.');
startReminderPoller();