const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const cooldowns = require('../../utils/cooldownManager');
const cooldownConfig = require('../../utils/cooldownConfig');
const giveCurrency = require('../../utils/giveCurrency');
const handleReminders = require('../../utils/reminderHandler');
const safeReply = require('../../utils/safeReply');

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shouldDropSopop() {
  // ~45% chance to get sopop
  return Math.random() < 0.45;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('perform')
    .setDescription('Perform for your fans and earn random currency!')
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
    const commandName = 'Perform';
    const cooldownMs = await cooldowns.getEffectiveCooldown(interaction, commandName);

if (await cooldowns.isOnCooldown(userId, commandName)) {
  const nextTime = await cooldowns.getCooldownTimestamp(userId, commandName);
  return safeReply(interaction, {
    content: `You're tired from your last performance. Come back **${nextTime}**.`,
  });
}

await cooldowns.setCooldown(userId, commandName, cooldownMs);

    // Generate randomized rewards
    const patterns = getRandomInt(1400, 1575);
    const sopop = shouldDropSopop() ? 1 : 0;

    // Give currency
    const user = await giveCurrency(userId, { patterns, sopop });

    await handleReminders(interaction, 'Perform', cooldownMs);

    // Create response
    const embed = new EmbedBuilder()
      .setTitle('🎤 Performance Complete!')
      .setDescription([
        `You earned:\n• <:ehx_patterns:1389584144895315978> **${patterns}** Patterns`,
        sopop ? `• <:ehx_sopop:1389584273337618542> **1** Sopop` : `• <:ehx_sopop:1389584273337618542> **0** Sopop`,
        `\n__Your Balance__:\n• <:ehx_patterns:1389584144895315978> ${user.patterns} Patterns\n• <:ehx_sopop:1389584273337618542> ${user.sopop} Sopop`
      ].join('\n'))
      .setColor('#f9a825');

    return safeReply(interaction, { embeds: [embed] });
  }
};