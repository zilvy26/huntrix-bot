const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../models/User');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription("Check yours or someone else's balance")
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The user to check (leave blank for yourself)')
        .setRequired(false)),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;

    let userData = await User.findOne({ userId });

    if (!userData) {
      userData = await User.create({
        userId,
        patterns: 5000,
        sopop: 1
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(`💰 Balance for ${targetUser.username}`)
      .addFields(
        { name: 'Patterns', value: `${userData.patterns}`, inline: true },
        { name: 'Sopop', value: `${userData.sopop}`, inline: true }
      )
      .setColor('#FFD700')
      .setFooter({ text: `Requested by ${interaction.user.username}` });

    return interaction.reply({ embeds: [embed] });
  }
};