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
  if (!interaction.isChatInputCommand()) return;

  const maintenance = await Maintenance.findOne();
  const bypassRoleId = process.env.MAIN_BYPASS_ID;
  const isBypassed = interaction.member?.roles?.cache.has(bypassRoleId);
  const isDev = interaction.user.id === interaction.client.application?.owner?.id;

  // 🔒 Maintenance mode check
  if (maintenance?.active && !isBypassed && !isDev) {
    return interaction.reply({
      content: '🚧 The bot is currently under maintenance. Please try again later.'
    });
  }

  // 🧠 Registration check (except for /register)
  if (interaction.commandName !== 'register') {
    const userExists = await User.exists({ userId: interaction.user.id });
    if (!userExists) {
      return interaction.reply({
        content: '🧠 You must register first using `/register` to use this command.'
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
      ephemeral: true
    });
  }

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error('❌ Error running command:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ There was an error executing the command.'
      });
    } else {
      await interaction.editReply({
        content: '❌ There was an error executing the command.'
      });
    }
  }
});

client.once('ready', () => {
  console.log(`🤖 Bot is online as ${client.user.tag}`);
});

mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log('🟢 Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

client.login(process.env.TOKEN);