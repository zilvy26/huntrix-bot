require('dotenv').config();
const { Client, GatewayIntentBits, Collection, ActivityType } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const Maintenance = require('../models/Maintenance');
const User = require('../models/User');
const getOrCreateUser = require('../utils/getOrCreateUser');
const interactionRouter = require('../utils/interactionRouter');
const vanityRoleChecker = require('../utils/vanityRoleChecker');
const Reminder = require('../models/Reminder');
const sendReminder = require('../utils/sendReminder');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences]
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

client.on('interactionCreate', async interaction => {
  if (!isBotReady) {
    return interaction.reply({ content: 'Bot is still starting up. Try again in a moment.' }).catch(() => {});
  }

  // 🧩 Route Buttons & Menus
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    return interactionRouter(interaction).catch(err =>
  console.error('Router error:', err)
)}

  // 💬 Slash Commands
  if (interaction.isChatInputCommand()) {
    const maintenance = await Maintenance.findOne();
    const bypassRoleId = process.env.MAIN_BYPASS_ID;
    let isBypassed = false;
if (interaction.inGuild() && interaction.member?.roles?.cache) {
  isBypassed = interaction.member.roles.cache.has(bypassRoleId);
}
    const isDev = interaction.user.id === interaction.client.application?.owner?.id;

    if (maintenance?.active && !isBypassed && !isDev) {
      return interaction.reply({
        content: 'The bot is currently under maintenance. Please try again later.'
      });
    }

    if (interaction.commandName !== 'register') {
      const userExists = await User.exists({ userId: interaction.user.id });
      if (!userExists) {
        return interaction.reply({
          content: 'You must register first using `/register` to use this command.'
        });
      }
    }

    try {
      interaction.userData = await getOrCreateUser(interaction);
    } catch (err) {
      console.error('Failed to get user data:', err);
      return interaction.reply({
        content: 'Failed to load your profile. Please try again later.',
        
      });
    }

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Error in command "${interaction.commandName}":`, err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'There was an error executing the command.' });
      } else {
        await interaction.editReply({ content: 'There was an error executing the command.' });
      }
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
    console.log(`🔁 Restored ${reminders.length} reminders`);
  }).catch(err => {
    console.error('❌ Failed to load reminders:', err);
  });
  cycleStatus();
  setInterval(() => vanityRoleChecker(client).catch(console.error), 10 * 60 * 1000);
});

mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log('🟢 Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

client.login(process.env.TOKEN);