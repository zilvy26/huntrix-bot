require('dotenv').config();
const { Client, GatewayIntentBits, Collection, ActivityType, Partials } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const Maintenance = require('../models/Maintenance');
const User = require('../models/User');
const getOrCreateUser = require('../utils/getOrCreateUser');
const interactionRouter = require('../utils/interactionRouter');
const Reminder = require('../models/Reminder');
const sendReminder = require('../utils/sendReminder');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel, Partials.Message]
});
let isBotReady = false;

// Load slash commands
client.commands = new Collection();
const commandsDir = path.join(__dirname, '../commands');
const commandFolders = ['global', 'guild-only'];

for (const folder of commandFolders) {
  const folderPath = path.join(commandsDir, folder);
  if (!fs.existsSync(folderPath)) continue;

  const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const command = require(path.join(folderPath, file));
    client.commands.set(command.data.name, command);
  }
}

// inside your existing setup file, replace the whole client.on('interactionCreate', ...) block

const { safeReply, safeDefer, withAckGuard } = require('../utils/safeReply');

client.on('interactionCreate', async (interaction) => {
  const tEnter = Date.now(); // <-- used to compute "pre" accurately

  if (!isBotReady) {
    return safeReply(interaction, { content: 'Bot is still starting up. Try again in a moment.', ephemeral: true });
  }

  // --- Buttons & Menus: pre‑ACK once, then route
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(() => {}); // swallow 10062/40060
      }
      await interactionRouter(interaction);
    } catch (err) {
      console.error('Router error (component):', err);
      await safeReply(
        interaction,
        { content: '❌ Error handling interaction.', ephemeral: true },
        { preferFollowUp: true }
      );
    }
    return;
  }

  // --- Slash Commands
  if (interaction.isChatInputCommand()) {
    const guard = withAckGuard(interaction, { timeoutMs: 450 }); // watchdog ON
    try {
      const t0 = Date.now();                 // moment we attempt to defer
      const ok = await safeDefer(interaction); // ACK first
      const pre = t0 - tEnter;               // time before calling defer
      const d   = Date.now() - t0;           // time inside defer
      console.log(`[ACK] ${interaction.commandName} pre=${pre}ms defer=${d}ms ping=${interaction.client.ws.ping} ok:${ok}`);
      if (!ok) return;

      // --- Maintenance (AFTER ACK)
      const maintenance = await Maintenance.findOne();
      const bypassRoleId = process.env.MAIN_BYPASS_ID;
      const isBypassed = interaction.inGuild() && interaction.member?.roles?.cache?.has(bypassRoleId);
      const isDev = interaction.user.id === interaction.client.application?.owner?.id;
      if (maintenance?.active && !isBypassed && !isDev) {
        return safeReply(interaction, { content: 'The bot is currently under maintenance. Please try again later.' });
      }

      // --- Registration (AFTER ACK)
      if (interaction.commandName !== 'register') {
        const userExists = await User.exists({ userId: interaction.user.id });
        if (!userExists) {
          return safeReply(interaction, { content: 'You must register first using `/register` to use this command.' });
        }
      }

      // --- Blacklist (AFTER ACK)
      const Blacklist = require('../models/Blacklist');
      const blacklisted = await Blacklist.findOne({ userId: interaction.user.id });
      if (blacklisted) {
        return safeReply(interaction, {
          content: `You are blacklisted from using this bot.\n**Blacklist Reason:** ${blacklisted.reason || 'No reason specified.'}`
        });
      }

      // --- Load/create user profile (AFTER ACK)
      try {
        interaction.userData = await getOrCreateUser(interaction);
      } catch (err) {
        console.error('Failed to get user data:', err);
        return safeReply(interaction, { content: 'Failed to load your profile. Please try again later.' });
      }

      // --- Execute command
      const command = client.commands.get(interaction.commandName);
      if (!command) return safeReply(interaction, { content: 'Unknown command.' });
      await command.execute(interaction);

    } catch (err) {
      console.error(`Error in "${interaction.commandName}":`, err);
      await safeReply(interaction, { content: '❌ There was an error executing the command.' }, { preferFollowUp: true });
    } finally {
      guard.end(); // stop the watchdog
    }
    return;
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
  // Reload persistent reminders from database
  Reminder.find().then(reminders => {
    const now = Date.now();
    for (const r of reminders) {
      const delay = new Date(r.expiresAt).getTime() - now;
      if (delay > 0) {
  setTimeout(() => sendReminder(client, r), delay);
} else {
  sendReminder(client, r); // <-- this triggers your reminder message AND deletes it
}
    }
  }).catch(err => {
    console.error('❌ Failed to load reminders:', err);
  });
  cycleStatus();
});

mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log('🟢 Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

client.login(process.env.TOKEN);