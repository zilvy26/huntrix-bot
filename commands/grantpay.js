require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../models/User');
const UserRecord = require('../models/UserRecord');

const GRANTING_ROLE_ID = process.env.GRANTING_ROLE_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grantpay')
    .setDescription('Give patterns or sopop to a user without balance restrictions')
    .addUserOption(opt =>
      opt.setName('target')
        .setDescription('User to receive the grant')
        .setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('patterns')
        .setDescription('Amount of patterns to grant')
        .setMinValue(1)
        .setRequired(false))
    .addIntegerOption(opt =>
      opt.setName('sopop')
        .setDescription('Amount of sopop to grant')
        .setMinValue(1)
        .setRequired(false)),

  async execute(interaction) {
    const sender = interaction.member;
    const targetUser = interaction.options.getUser('target');
    const patterns = interaction.options.getInteger('patterns') || 0;
    const sopop = interaction.options.getInteger('sopop') || 0;

    if (!sender.roles.cache.has(GRANTING_ROLE_ID)) {
      return interaction.reply({ content: '❌ You do not have permission to use this command.' });
    }

    if (!patterns && !sopop) {
      return interaction.reply({ content: '❌ You must specify patterns or sopop to grant.' });
    }

    const userDoc = await User.findOneAndUpdate(
      { userId: targetUser.id },
      {
        $inc: {
          patterns: patterns,
          sopop: sopop
        }
      },
      { upsert: true, new: true }
    );

    await UserRecord.create({
      userId: targetUser.id,
      type: 'grantpay',
      targetId: interaction.user.id,
      detail: `Granted <:ehx_patterns:1389584144895315978> ${patterns} and <:ehx_sopop:1389584273337618542> ${sopop} by <@${interaction.user.id}>`
    });

    const embed = new EmbedBuilder()
      .setTitle('Grant Issued')
      .setColor('#2f3136')
      .setDescription([
        `Successfully paid:`,
        patterns ? `• <:ehx_patterns:1389584144895315978> **${patterns}** Patterns` : null,
        sopop ? `• <:ehx_sopop:1389584273337618542> **${sopop}** Sopop` : null,
        `👤 To: ${targetUser}`
      ].filter(Boolean).join('\n'));

    return interaction.reply({ embeds: [embed] });
  }
};