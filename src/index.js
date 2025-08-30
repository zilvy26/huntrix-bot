// Force Node to prefer IPv4 over IPv6 for DNS lookups
require('dns').setDefaultResultOrder?.('ipv4first');
require('dotenv').config();
const { Client, GatewayIntentBits, Collection, ActivityType, Partials } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { enqueueInteraction } = require('../queue'); // if index.js is inside src/
const RUN_LOCAL = new Set(['ping','help','showcase','refund', 'about','vote','index', 'rehearsal','profile', 'tradecard', 'trademulti', 'grantrandom', 'grantpay', 'grantcard', 'list', 'balance', 'boutique', 'boutiquecards', 'records', 'editcards', 'createcard', 'stall', 'stallpreview', 'spawn', 'recommend', 'recommendsubmit', 'recommendreset', 'recommendset', 'message']); // tiny/fast ones only

const Maintenance = require('../models/Maintenance');
const User = require('../models/User');
const getOrCreateUser = require('../utils/getOrCreateUser');
const interactionRouter = require('../utils/interactionRouter');

// ⬇️ add this after the other requires (top of file)
const { monitorEventLoopDelay } = require('perf_hooks');
const el = monitorEventLoopDelay({ resolution: 5 });
el.enable();
setInterval(() => {
  const p95 = Math.round(el.percentile(95) / 1e6);
  if (p95 > 100) console.warn(`[ELOOP] 95th=${p95}ms (event-loop blocking)`);
  el.reset();
}, 10_000).unref();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User]
});

client.rest.on('rateLimited', (info) => {
  console.warn(
    `[REST-RL] timeout=${info.timeout}ms global=${info.global} ` +
    `route=${info.route} limit=${info.limit} method=${info.method} bucket=${info.bucket}`
  );
});

let isBotReady = false;

// Commands loader
client.commands = new Collection();
const commandsDir = path.join(__dirname, '../commands');
for (const folder of ['global', 'guild-only']) {
  const folderPath = path.join(commandsDir, folder);
  if (!fs.existsSync(folderPath)) continue;
  for (const file of fs.readdirSync(folderPath).filter(f => f.endsWith('.js'))) {
    const command = require(path.join(folderPath, file));
    client.commands.set(command.data.name, command);
  }
}

const { safeReply, safeDefer } = require('../utils/safeReply');

client.on('interactionCreate', async (interaction) => {
  const tEnter = Date.now();

  if (!isBotReady) {
    // flags: 1<<6 == ephemeral
    return safeReply(interaction, { content: 'Bot is still starting up. Try again in a moment.', flags: 1 << 6 });
  }

  // Buttons & Menus
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    // Acknowledge instantly for components:
    try {
      await interaction.deferUpdate();       // ALWAYS defer components
      await interactionRouter(interaction);  // then do your work and followUp as needed
    } catch (err) {
      console.error('[btn] handler error:', err);
    }
    return;
  }
  // Slash commands
  if (interaction.isChatInputCommand()) {
  try {
    // 1) ACK immediately (no watchdog, no double-messages)
    await safeDefer(interaction); // same as await interaction.deferReply();

    // 2) Maintenance / auth gates (now safe after defer)
    const maintenance = await Maintenance.findOne();
    const bypassRoleId = process.env.MAIN_BYPASS_ID;
    const isBypassed = interaction.inGuild() && interaction.member?.roles?.cache?.has(bypassRoleId);
    const isDev = interaction.user.id === interaction.client.application?.owner?.id;
    if (maintenance?.active && !isBypassed && !isDev) {
      return safeReply(interaction, { content: 'The bot is currently under maintenance. Please try again later.' });
    }

    if (interaction.commandName !== 'register') {
      const userExists = await User.exists({ userId: interaction.user.id });
      if (!userExists) {
        return safeReply(interaction, { content: 'You must register first using `/register` to use this command.' });
      }
    }

    const Blacklist = require('../models/Blacklist');
    const blacklisted = await Blacklist.findOne({ userId: interaction.user.id });
    if (blacklisted) {
      return safeReply(interaction, {
        content: `You are blacklisted from using this bot.\n**Blacklist Reason:** ${blacklisted.reason || 'No reason specified.'}`
      });
    }

    try {
      interaction.userData = await getOrCreateUser(interaction);
    } catch (err) {
      console.error('Failed to get user data:', err);
      return safeReply(interaction, { content: 'Failed to load your profile. Please try again later.' });
    }

    // 3) Find command and route
    const command = client.commands.get(interaction.commandName);
    if (!command) return safeReply(interaction, { content: 'Unknown command.' });

    // Queue heavy commands; run small ones locally
    if (!RUN_LOCAL.has(interaction.commandName)) {
      await enqueueInteraction(interaction);         // worker will send the ONLY visible message
      return;                                        // do NOT send any local message
    }

    // Local execution for allow-listed commands
    await command.execute(interaction);

  } catch (err) {
    console.error(`Error in "${interaction.commandName}":`, err);
    await safeReply(interaction, { content: '❌ There was an error executing the command.' }, { preferFollowUp: true });
  }
}
});

// Array of statuses
const statuses = [
  "Mirror mirror on my phone, who's the baddest? us, hello?!",
  "Restoring the Honmoon",
  "It's a takedown",
  "A demon with no feelings don't deserve to live",
  "You're not god, but you're good for me",
  "COUCH COUCH COUCH COUCH",
  "You know together we're glowin",
  "STAN HUNTRIX",
  "We are hunters, voice strong and I know I believe",
  "STAN SAJA BOYS",
  "IM NOT SITTING WITH NO SAJA- hehe what's up~",
  "This is what it sounds like",
  "Heels 👠 , Nails 💅 , Blade 🗡️, Mascara",
  "FIT CHECK FOR MY NAPALM ERA"
];

function cycleStatus() {
  let index = 0;

  setInterval(() => {
    const status = statuses[index];
    client.user.setPresence({
      activities: [{ name: status, type: ActivityType.Custom }],
      status: 'online'
    });

    index = (index + 1) % statuses.length;
  }, getRandomDelay());
}

// Random delay between 30s and 160s
function getRandomDelay() {
  return Math.floor(Math.random() * (160 - 30 + 1) + 30) * 1000;
}

client.once('ready', () => {
  console.log(`🤖 Bot is online as ${client.user.tag}`);
  isBotReady = true;
  cycleStatus();
});

mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log('🟢 Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

client.login(process.env.TOKEN);