const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Card = require('../models/Card');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cleancardimages')
    .setDescription('Remove old image links from cards that already use localImagePath')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply();

    const result = await Card.updateMany(
      { localImagePath: { $exists: true, $ne: null } },
      { $unset: { imgurImageLink: "", discordPermalinkImage: "" } }
    );

    await interaction.editReply(`✅ Cleaned ${result.modifiedCount} card(s). Old image links removed.`);
  }
};