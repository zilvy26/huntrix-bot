// commands/guild-only/blacklist.js
const { SlashCommandBuilder } = require('discord.js');
const Blacklist = require('../../models/Blacklist');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Blacklist a user from using the bot.')
    .setDefaultMemberPermissions('0')
    .addUserOption(opt => opt.setName('user').setDescription('User to blacklist').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for blacklist').setRequired(false)),

  async execute(interaction) {
    const sender = interaction.member;

    if (!sender.roles.cache.has(GRANTING_ROLE_ID)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', flags: 1 << 6 });
    }

    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const exists = await Blacklist.findOne({ userId: user.id });
    if (exists) {
      return interaction.reply({ content: 'User is already blacklisted.' });
    }

    await Blacklist.create({ userId: user.id, reason });

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