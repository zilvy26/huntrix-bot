require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const Maintenance = require('../models/Maintenance');
const User = require('../models/User');
const getOrCreateUser = require('../utils/getOrCreateUser'); // 🔥 Import middleware util

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});
let isBotReady = false;

// Load slash commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, '../commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

// Handle slash command interactions
client.on('interactionCreate', async interaction => {
   if (!isBotReady) {
    return interaction.reply({
      content: '🕒 Bot is still starting up. Try again in a moment.',
      
    }).catch(() => {});
  }
  if (!interaction.isChatInputCommand()) {
    // 🛡️ Prevent ghost button/select interactions after restarts
    if (interaction.isButton() || interaction.isSelectMenu()) {
      return interaction.reply({ content: '⚠️ This interaction has expired.' }).catch(() => {});
    }
    return;
  }

  const maintenance = await Maintenance.findOne();
  const bypassRoleId = process.env.MAIN_BYPASS_ID;
  const isBypassed = interaction.member?.roles?.cache.has(bypassRoleId);
  const isDev = interaction.user.id === interaction.client.application?.owner?.id;

  // 🔒 Maintenance mode check
  if (maintenance?.active && !isBypassed && !isDev) {
    return interaction.reply({
      content: 'The bot is currently under maintenance. Please try again later.'
    });
  }

  // 🧠 Registration check (except for /register)
  if (interaction.commandName !== 'register') {
    const userExists = await User.exists({ userId: interaction.user.id });
    if (!userExists) {
      return interaction.reply({
        content: 'You must register first using `/register` to use this command.'
      });
    }
  }

  // 🧩 Inject user data into interaction for all commands
  try {
    interaction.userData = await getOrCreateUser(interaction);
  } catch (err) {
    console.error('❌ Failed to get user data:', err);
    return interaction.reply({
      content: '⚠️ Failed to load your profile. Please try again later.',
      
    });
  }

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`❌ Error in command "${interaction.commandName}":`, error);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ There was an error executing the command.',
          
        });
      } else {
        await interaction.editReply({
          content: '❌ There was an error executing the command.'
        });
      }
    } catch (err2) {
      console.warn('⚠️ Failed to send error response:', err2.message);
    }
  }
});

client.once('ready', () => {
  console.log(`🤖 Bot is online as ${client.user.tag}`);
  isBotReady = true;
});

mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log('🟢 Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

client.login(process.env.TOKEN);