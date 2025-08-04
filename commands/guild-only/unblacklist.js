// commands/guild-only/unblacklist.js
const { SlashCommandBuilder } = require('discord.js');
const Blacklist = require('../../models/Blacklist');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unblacklist')
    .setDescription('Remove a user from blacklist.')
    .setDefaultMemberPermissions('0')
    .addUserOption(opt => opt.setName('user').setDescription('User to unblacklist').setRequired(true)),

  async execute(interaction) {
    const sender = interaction.member;

    if (!sender.roles.cache.has(GRANTING_ROLE_ID)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', flags: 1 << 6 });
    }

    const user = interaction.options.getUser('user');

    const result = await Blacklist.findOneAndDelete({ userId: user.id });
    if (!result) {
      return interaction.reply({ content: 'User is not blacklisted.' });
    }

    try {
      const dm = await user.createDM();
      await dm.send(`You have been blacklisted from using the bot.\n**Reason:** ${reason}`);
    } catch (err) {
      console.warn(`Could not DM user ${user.tag}:`, err.message);
    }

    return interaction.reply({
      content: `<@${user.id}> has been blacklisted.\n**Reason:** ${reason}`,
    });
  }
};