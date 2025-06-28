require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const config = require('../config/config');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once('ready', async () => {
  console.log(`🤖 Bot is online as ${client.user.tag}`);

  try {
    await mongoose.connect(config.mongoURI);
    console.log('🟢 Connected to MongoDB');
  } catch (error) {
    console.error('🔴 MongoDB connection error:', error);
  }
});

client.login(config.token);