const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const {safeReply} = require('../../utils/safeReply');
const Maintenance = require('../../models/Maintenance');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('maintenance')
    .setDescription('Toggle bot maintenance mode')
    .setDefaultMemberPermissions('0'),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(process.env.MAIN_BYPASS_ID)) {
    return safeReply(interaction, { content: 'You do not have permission to use this command.' });
    }

    const current = await Maintenance.findOne() || new Maintenance();
    current.active = !current.active;
    await current.save();

    return safeReply(interaction, {
      content: `Maintenance mode is now **${current.active ? 'ENABLED' : 'DISABLED'}**.`,
    });
  }
};