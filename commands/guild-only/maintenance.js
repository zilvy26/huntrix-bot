const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Maintenance = require('../../models/Maintenance');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('maintenance')
    .setDescription('Toggle bot maintenance mode')
    .setDefaultMemberPermissions('0'),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(process.env.MAIN_BYPASS_ID)) {
    return interaction.reply({ content: 'You do not have permission to use this command.' });
    }

    const current = await Maintenance.findOne() || new Maintenance();
    current.active = !current.active;
    await current.save();

    return interaction.reply({
      content: `Maintenance mode is now **${current.active ? 'ENABLED' : 'DISABLED'}**.`,
    });
  }
};