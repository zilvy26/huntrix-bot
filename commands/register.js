const { SlashCommandBuilder } = require('discord.js');
const User = require('../models/User');
const UserInventory = require('../models/UserInventory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Register a new user for Huntrix'),

  async execute(interaction) {
    try {
      const existing = await User.findOne({ userId: interaction.user.id });

      if (existing) {
        await interaction.reply({
          content: 'You already have an account!',
        });
        return;
      }

      const newUser = new User({
        userId: interaction.user.id,
        username: interaction.user.username
      });

      await newUser.save();

      // 🧠 Create empty inventory for new user
      await UserInventory.create({
        userId: interaction.user.id,
        cards: []
      });

      await interaction.reply({
        content: 'You have now debuted — let us build the Honmoon together!',
      });

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