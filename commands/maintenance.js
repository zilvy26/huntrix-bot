const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Maintenance = require('../models/Maintenance');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('maintenance')
    .setDescription('Toggle bot maintenance mode')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const current = await Maintenance.findOne() || new Maintenance();
    current.active = !current.active;
    await current.save();

    return interaction.reply({
      content: `🧰 Maintenance mode is now **${current.active ? 'ENABLED' : 'DISABLED'}**.`,
    });
  }
};