const { SlashCommandBuilder } = require('discord.js');
const {safeReply} = require('../../utils/safeReply');
const RedeemCode = require('../../models/RedeemCode');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createcode')
    .setDescription('Admin only: Create a redeem code')
    .setDefaultMemberPermissions('0')
    .addStringOption(opt =>
      opt.setName('code')
        .setDescription('Custom code (leave blank to generate randomly)'))
    .addIntegerOption(opt =>
      opt.setName('patterns')
        .setDescription('Patterns reward'))
    .addStringOption(opt =>
      opt.setName('cardcode')
        .setDescription('Card code to grant (optional)'))
    .addBooleanOption(opt =>
      opt.setName('allowchoice')
        .setDescription('Let user pick any card (except "others")'))
    .addIntegerOption(opt =>
      opt.setName('maxuses')
        .setDescription('Maximum times the code can be used (default: 1)'))
    .addStringOption(opt =>
      opt.setName('expiresat')
        .setDescription('Expiration date (e.g. 2025-08-01T00:00:00)')),

  async execute(interaction) {
    const userId = interaction.user.id;

    // ✅ Optional: Admin check
    const ALLOWED_ROLE_ID = '1386797486680703036'; // replace with your actual role ID

    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
    return safeReply(interaction, { content: 'Only authorized staff can use this command.' });
}

    const inputCode = interaction.options.getString('code');
    const code = inputCode || `EHX-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const reward = {
      patterns: interaction.options.getInteger('patterns') || 0,
    };

    const cardCode = interaction.options.getString('cardcode');
    const allowCardChoice = interaction.options.getBoolean('allowchoice') || false;
    const maxUses = interaction.options.getInteger('maxuses') || 1;

    const expiresAtString = interaction.options.getString('expiresat');
    let expiresAt = null;
    if (expiresAtString) {
      const parsed = new Date(expiresAtString);
      if (!isNaN(parsed)) expiresAt = parsed;
    }

    // Save new code
    const newCode = await RedeemCode.create({
      code,
      reward,
      cardCode,
      allowCardChoice,
      maxUses,
      expiresAt
    });

    const summary = [
      `**Code:** \`${newCode.code}\``,
      newCode.reward.patterns ? `• ${newCode.reward.patterns} Patterns` : null,
      newCode.cardCode ? `• Card Code: ${newCode.cardCode}` : null,
      newCode.allowCardChoice ? `• User can choose a card` : null,
      newCode.expiresAt ? `• Expires: ${newCode.expiresAt.toLocaleString()}` : null,
      `• Max Uses: ${newCode.maxUses}`
    ].filter(Boolean).join('\n');

    return safeReply(interaction, { content: `Created redeem code:\n${summary}` });
  }
};