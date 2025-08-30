const {safeReply} = require('../../utils/safeReply');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const cooldowns = require('../../utils/cooldownManager');
const cooldownConfig = require('../../utils/cooldownConfig');
const handleReminders = require('../../utils/reminderHandler');
const pickRarity = require('../../utils/rarityPicker');
const getRandomCardByRarity = require('../../utils/randomCardFromRarity');
const generateStars = require('../../utils/starGenerator');
const giveCurrency = require('../../utils/giveCurrency');
const UserInventory = require('../../models/UserInventory');
const UserRecord = require('../../models/UserRecord');
const topgg = require('../../topgg'); // your top.gg setup

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shouldDropSopop() {
  return Math.random() < 0.46;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vote')
    .setDescription('Vote for the bot on top.gg and get rewards!')
    .addBooleanOption(opt =>
      opt.setName('reminder').setDescription('Remind you when cooldown ends').setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('remindinchannel').setDescription('Remind in this channel instead of DM').setRequired(false)),

  async execute(interaction) {
    const userId = interaction.user.id;
    const commandName = 'Vote';
    const cooldownMs = await cooldowns.getEffectiveCooldown(interaction, commandName);
    const voteLink = `https://top.gg/bot/${interaction.client.user.id}/vote`;

    if (await cooldowns.isOnCooldown(userId, commandName)) {
          const nextTime = await cooldowns.getCooldownTimestamp(userId, commandName);
          return safeReply(interaction, {
            content: `You can vote again **${nextTime}**`,
          });
        }

    let hasVoted = false;
    try {
      hasVoted = await topgg.hasVoted(userId);
    } catch (err) {
      console.warn('Top.gg API error:', err.message);
    }

    if (!hasVoted) {
      return safeReply(interaction, {
        content: `You haven’t voted yet!\n [Click here to vote](${voteLink})`,
        ephemeral: true
      });
    }

    await cooldowns.setCooldown(userId, commandName, cooldownMs);
    await handleReminders(interaction, commandName, cooldownMs);
    const inventory = await UserInventory.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId, cards: [] } },
      { upsert: true, new: true }
    );

    const cardLines = [];
    const pulledCards = [];

    for (let i = 0; i < 3; i++) {
      const rarity = await pickRarity();
      const card = await getRandomCardByRarity(rarity);
      if (!card) continue;

      const stars = generateStars({
        rarity: card.rarity,
        overrideEmoji: card.emoji || '<:fullstar:1387609456824680528>'
      });

      cardLines.push([
        `${stars} **${card.name}**`,
        `• Group: ${card.group}`,
        ...(card.category?.toLowerCase() === 'kpop' ? [`• Era: ${card.era}`] : []),
        `• Code: \`${card.cardCode}\``
      ].join('\n'));

      pulledCards.push(`${card.name} (${card.cardCode})`);

      const existing = inventory.cards.find(c => c.cardCode === card.cardCode);
      if (existing) existing.quantity += 1;
      else inventory.cards.push({ cardCode: card.cardCode, quantity: 1 });
    }

    await inventory.save();

    const patterns = getRandomInt(2385, 2585);
    const sopop = shouldDropSopop() ? 2 : 1;
    const user = await giveCurrency(userId, { patterns, sopop });

    const embeds = [
      new EmbedBuilder()
        .setTitle('You received 3 cards for voting!')
        .setDescription(cardLines.join('\n\n'))
        .setColor('#00c896'),

      new EmbedBuilder()
        .setTitle('Vote Reward')
        .setDescription([
          `Thanks for voting! You received:`,
          `• <:ehx_patterns:1389584144895315978> **${patterns}** Patterns`,
          `• <:ehx_sopop:1389584273337618542> **${sopop}** Sopop`,
          `\nYour balance:\n• Patterns: ${user.patterns}\n• Sopop: ${user.sopop}`
        ].join('\n'))
        .setColor('#f9a825')
    ];

    await UserRecord.create({
      userId,
      type: 'vote',
      detail: `Voted & received 3 cards + ${patterns} patterns + ${sopop} sopop`
    });

    return safeReply(interaction, { embeds });
  }
};