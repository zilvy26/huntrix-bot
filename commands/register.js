const { SlashCommandBuilder } = require('discord.js');
const getOrCreateUser = require('../utils/getOrCreateUser');
const UserInventory = require('../models/UserInventory');
const User = require('../models/User');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Register a new user for Huntrix'),

  async execute(interaction) {
    try {
      const existed = await User.exists({ userId: interaction.user.id });
      const user = await getOrCreateUser(interaction); // auto create or sync user

      // 🧠 Create empty inventory if not already present
      const inventoryExists = await UserInventory.exists({ userId: interaction.user.id });
      if (!inventoryExists) {
        await UserInventory.create({ userId: interaction.user.id, cards: [] });
      }

      const message = existed
        ? `Welcome back, ${user.username}! You're already registered.`
        : `You have now debuted — let us build the Honmoon together!`;

      await interaction.reply({ content: message });

    } catch (err) {
      console.error('❌ Error in /register:', err);
      if (!interaction.replied) {
        await interaction.reply({
          content: '❌ Something went wrong while registering you.',
        });
      }
    }
  }
};