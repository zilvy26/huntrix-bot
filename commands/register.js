const { SlashCommandBuilder } = require('discord.js');
const User = require('../models/User');

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

      await interaction.reply({
        content: 'You are now registered, welcome to Huntrix!'
      });

    } catch (err) {
      console.error('❌ Error in /register:', err);
      // Only reply if we haven’t replied yet
      if (!interaction.replied) {
        await interaction.reply({
          content: '❌ Something went wrong while registering you.',
        });
      }
    }
  }
};