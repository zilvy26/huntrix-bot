const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');
const { safeReply } = require('../../utils/safeReply');

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
        sopop: 2
      });
    }

    const embed = new EmbedBuilder()
  .setTitle(`Balance for ${targetUser.username}`)
  .addFields(
    { 
      name: '__Patterns__', 
      value: `<:ehx_patterns:1389584144895315978> ${userData.patterns.toLocaleString()}`, 
      inline: true 
    },
    { 
      name: '__Sopop__', 
      value: `<:ehx_sopop:1389584273337618542> ${userData.sopop.toLocaleString()}`, 
      inline: true 
    }
  )
  .setColor('#FFD700')
  .setFooter({ text: `Requested by ${interaction.user.username}` });

    return safeReply(interaction, { embeds: [embed] });
  }
};