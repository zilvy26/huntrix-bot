const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const cooldowns = require('../../utils/cooldownManager');
const cooldownConfig = require('../../utils/cooldownConfig');
const giveCurrency = require('../../utils/giveCurrency');
const handleReminders = require('../../utils/reminderHandler');
const User = require('../../models/User'); // Adjust path if needed

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily reward!')
    .addBooleanOption(opt =>
      opt.setName('reminder')
        .setDescription('Remind you when cooldown ends')
        .setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('remindinchannel')
        .setDescription('Remind in the command channel instead of DM (default: true)')
        .setRequired(false)),

  async execute(interaction) {
    const userId = interaction.user.id;
    const commandName = 'Daily';
    const cooldownDuration = cooldownConfig[commandName];

    // Check cooldown
    if (await cooldowns.isOnCooldown(userId, commandName)) {
  const nextTime = await cooldowns.getCooldownTimestamp(userId, commandName);
  return interaction.reply({
    content: `You already claimed your daily reward. Try again **${nextTime}**.`,
  });
}

    // Calculate streak logic
    const now = new Date();
    const oneDay = 24 * 60 * 60 * 1000;

    let userData = await User.findOne({ userId });
    if (!userData) {
      userData = await User.create({ userId, dailystreak: { count: 0, lastClaim: now } });
    }

    const lastClaim = new Date(userData.dailystreak?.lastClaim || 0);
    const diff = now - lastClaim;
    let streak = userData.dailystreak?.count || 0;

    if (diff < oneDay) {
      return interaction.reply({
        content: `You already claimed your daily reward. Try again later.`,
        
      });
    } else if (diff < oneDay * 2) {
      streak++;
    } else {
      streak = 1;
    }

    // Calculate scaling reward
    // Calculate tiered reward scaling
    function calculateDailyReward(streak) {
  const sopop = 3 + Math.min(7, Math.floor(streak / 45));       // +1 per 30 days, max +7
  const patterns = 10000 + Math.min(10000, Math.floor(streak / 15) * 300);  // +300 per 15 days, max +10000
  return { sopop, patterns };
  }

    const reward = calculateDailyReward(streak);

    // Save streak data and set cooldown
    userData.dailystreak = { count: streak, lastClaim: now };
    await userData.save();
    await cooldowns.setCooldown(userId, commandName, cooldownDuration);

    // Grant currency
    const user = await giveCurrency(userId, reward);
    await handleReminders(interaction, commandName, cooldownDuration);

    // Response embed
    const embed = new EmbedBuilder()
      .setTitle('Daily Reward Claimed!')
      .setDescription([
        `Current Streak: **${streak} days**`,
        `You've received:\n• <:ehx_patterns:1389584144895315978> **${reward.patterns}** Patterns\n• <:ehx_sopop:1389584273337618542> **${reward.sopop}** Sopop`,
        `\n__Your Balance__:\n• <:ehx_patterns:1389584144895315978> ${user.patterns} Patterns\n• <:ehx_sopop:1389584273337618542> ${user.sopop} Sopop`
      ].join('\n'))
      .setColor('#78c5f1');

    return interaction.reply({ embeds: [embed] });
  }
};