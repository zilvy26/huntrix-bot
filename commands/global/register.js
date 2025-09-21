// commands/global/register.js
const { SlashCommandBuilder } = require('discord.js');
const getOrCreateUser = require('../../utils/getOrCreateUser');
const User = require('../../models/User');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Register a new user for Huntrix'),

  async execute(interaction) {
    try {
      // Check if a User doc already exists BEFORE creating/syncing
      const existed = await User.exists({ userId: interaction.user.id });

      // Create/sync the user profile (your existing util)
      const user = await getOrCreateUser(interaction);

      // With the new per-item InventoryItem model, there is nothing to pre-create here.
      // (Each owned card gets its own { userId, cardCode, quantity } doc when acquired.)

      const message = existed
        ? `Welcome back, ${user.username}! You're already registered.`
        : `You have now debuted — let us build the Honmoon together!`;

      await safeReply(interaction, { content: message });

    } catch (err) {
      console.error('❌ Error in /register:', err);
      if (!interaction.replied) {
        await safeReply(interaction, {
          content: '❌ Something went wrong while registering you.',
        });
      }
    }
  }
};