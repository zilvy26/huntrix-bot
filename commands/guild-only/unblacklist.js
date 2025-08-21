require('dotenv').config();
const { SlashCommandBuilder } = require('discord.js');
const safeReply = require('../../utils/safeReply');
const Blacklist = require('../../models/Blacklist');
const GRANTING_ROLE_ID = process.env.GRANTING_ROLE_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unblacklist')
    .setDescription('Remove a user from blacklist.')
    .setDefaultMemberPermissions('0')
    .addUserOption(opt =>
      opt.setName('user').setDescription('User to unblacklist').setRequired(true)),

  async execute(interaction) {
    const sender = interaction.member;

    if (!sender.roles.cache.has(GRANTING_ROLE_ID)) {
      return safeReply(interaction, {
        content: 'You do not have permission to use this command.',
        ephemeral: true
      });
    }

    const user = interaction.options.getUser('user');

    const result = await Blacklist.findOneAndDelete({ userId: user.id });
    if (!result) {
      return safeReply(interaction, { content: 'User is not blacklisted.'});
    }

    // ✅ DM the user informing they’ve been unblacklisted
    try {
      const dm = await user.createDM();
      await dm.send(`You have been removed from the bot blacklist. You may now use commands again.`);
    } catch (err) {
      console.warn(`Could not DM user ${user.tag}:`, err.message);
    }

    return safeReply(interaction, {
      content: `<@${user.id}> has been unblacklisted.`,
    });
  }
};