require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {safeReply} = require('../../utils/safeReply');
const User = require('../../models/User');
const UserRecord = require('../../models/UserRecord');

const GRANTING_ROLE_ID = process.env.GRANTING_ROLE_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grantpay')
    .setDescription('Give or remove patterns from a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.DeafenMembers)
    .addUserOption(opt =>
      opt.setName('target')
        .setDescription('User to receive or lose currency')
        .setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('patterns')
        .setDescription('Amount of patterns to grant (or negative to remove)')
        .setRequired(false)),

  async execute(interaction) {
    const sender = interaction.member;
    const targetUser = interaction.options.getUser('target');
    const patterns = interaction.options.getInteger('patterns') || 0;

    if (!sender.roles.cache.has(GRANTING_ROLE_ID)) {
      return safeReply(interaction, { content: 'You do not have permission to use this command.', flags: 1 << 6 });
    }

    if (!patterns) {
      return safeReply(interaction, { content: 'You must specify patterns to grant or remove.', flags: 1 << 6 });
    }

    const userDoc = await User.findOneAndUpdate(
      { userId: targetUser.id },
      {
        $inc: {
          patterns: patterns,
        }
      },
      { upsert: true, new: true }
    );

    const verb = patterns < 0 ? 'Removed from' : 'Granted to';
    const detail = [
      patterns ? `${patterns < 0 ? 'Removed' : 'Granted'} <:ehx_patterns:1389584144895315978> ${Math.abs(patterns)}` : null,
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
      ].filter(Boolean).join('\n'));

    return safeReply(interaction, { embeds: [embed] });
  }
};