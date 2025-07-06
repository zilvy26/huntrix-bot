const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const cooldowns = require('../utils/cooldownManager');
const cooldownConfig = require('../utils/cooldownConfig');
const giveCurrency = require('../utils/giveCurrency');
const handleReminders = require('../utils/reminderHandler');

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
    const commandName = 'daily';
    const cooldownDuration = cooldownConfig[commandName];

    // Cooldown check
    if (cooldowns.isOnCooldown(userId, commandName)) {
      const nextTime = cooldowns.getCooldownTimestamp(userId, commandName);
      return interaction.reply({
        content: `⏳ You already claimed your daily reward. Try again **${nextTime}**.`,
        
      });
    }

    // Set cooldown
    cooldowns.setCooldown(userId, commandName, cooldownDuration);

    // Reward values
    const reward = {
      patterns: 10000,
      sopop: 3,
    };

    // Grant currency
    const user = await giveCurrency(userId, reward);

    await handleReminders(interaction, 'daily', cooldownDuration);

    // Response embed
    const embed = new EmbedBuilder()
      .setTitle('🎁 Daily Reward Claimed!')
      .setDescription([`You've received:\n• <:ehx_patterns:1389584144895315978> **${reward.patterns}** Patterns\n• <:ehx_sopop:1389584273337618542> **${reward.sopop}** Sopop`,
        `\n__Your Balance__:\n• <:ehx_patterns:1389584144895315978> ${user.patterns} Patterns\n• <:ehx_sopop:1389584273337618542> ${user.sopop} Sopop`
      ].join('\n'))
      .setColor('#78c5f1');

    return interaction.reply({ embeds: [embed] });
  }
};