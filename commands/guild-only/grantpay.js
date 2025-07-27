require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');
const UserRecord = require('../../models/UserRecord');

const GRANTING_ROLE_ID = process.env.GRANTING_ROLE_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grantpay')
    .setDescription('Give or remove patterns or sopop from a user')
    .addUserOption(opt =>
      opt.setName('target')
        .setDescription('User to receive or lose currency')
        .setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('patterns')
        .setDescription('Amount of patterns to grant (or negative to remove)')
        .setRequired(false))
    .addIntegerOption(opt =>
      opt.setName('sopop')
        .setDescription('Amount of sopop to grant (or negative to remove)')
        .setRequired(false)),

  async execute(interaction) {
    const sender = interaction.member;
    const targetUser = interaction.options.getUser('target');
    const patterns = interaction.options.getInteger('patterns') || 0;
    const sopop = interaction.options.getInteger('sopop') || 0;

    if (!sender.roles.cache.has(GRANTING_ROLE_ID)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', flags: 1 << 6 });
    }

    if (!patterns && !sopop) {
      return interaction.reply({ content: 'You must specify patterns or sopop to grant or remove.', flags: 1 << 6 });
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

    const verb = patterns < 0 || sopop < 0 ? 'Removed from' : 'Granted to';
    const detail = [
      patterns ? `${patterns < 0 ? 'Removed' : 'Granted'} <:ehx_patterns:1389584144895315978> ${Math.abs(patterns)}` : null,
      sopop ? `${sopop < 0 ? 'Removed' : 'Granted'} <:ehx_sopop:1389584273337618542> ${Math.abs(sopop)}` : null
    ].filter(Boolean).join(' and ');

    await UserRecord.create({
      userId: targetUser.id,
      type: 'grantpay',
      targetId: interaction.user.id,
      detail: `${detail} by <@${interaction.user.id}>`
    });

    const embed = new EmbedBuilder()
      .setTitle('Grant Executed')
      .setColor('#2f3136')
      .setDescription([
        `${verb} ${targetUser}:`,
        patterns ? `• <:ehx_patterns:1389584144895315978> **${patterns}**` : null,
        sopop ? `• <:ehx_sopop:1389584273337618542> **${sopop}**` : null
      ].filter(Boolean).join('\n'));

    return interaction.reply({ embeds: [embed] });
  }
};