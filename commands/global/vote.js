// commands/global/vote.js
const { safeReply } = require('../../utils/safeReply');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const cooldowns = require('../../utils/cooldownManager');
const cooldownConfig = require('../../utils/cooldownConfig'); // if you use it elsewhere
const handleReminders = require('../../utils/reminderHandler');
const pickRarity = require('../../utils/rarityPicker');
const getRandomCardByRarity = require('../../utils/randomCardFromRarity');
const generateStars = require('../../utils/starGenerator');
const giveCurrency = require('../../utils/giveCurrency');
const InventoryItem = require('../../models/InventoryItem');             // ✅ NEW
const UserRecord = require('../../models/UserRecord');
const topgg = require('../../topgg'); // your top.gg setup

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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

    // Cooldown gate
    if (await cooldowns.isOnCooldown(userId, commandName)) {
      const nextTime = await cooldowns.getCooldownTimestamp(userId, commandName);
      return safeReply(interaction, { content: `You can vote again **${nextTime}**` });
    }
    // Check top.gg
    let hasVoted = false;
    try {
      hasVoted = await topgg.hasVoted(userId);
    } catch (err) {
      console.warn('Top.gg API error:', err.message);
    }
    if (!hasVoted) {
      return safeReply(interaction, {
        content: `You haven’t voted yet!\n[Click here to vote](${voteLink})`,
        ephemeral: true
      });
    }

    // Set cooldown & optional reminder
    await cooldowns.setCooldown(userId, commandName, cooldownMs);
    await handleReminders(interaction, commandName, cooldownMs);

    // Pull 3 cards
    const showEraFor = new Set(['kpop', 'zodiac', 'event']);
    const cardLines = [];
    const pulled = []; // keep Card docs for inventory ops + logging

    for (let i = 0; i < 3; i++) {
      const rarity = await pickRarity();
      const card = await getRandomCardByRarity(rarity, userId);
      if (!card) continue;

      const stars = generateStars({
        rarity: card.rarity,
        overrideEmoji: card.emoji || '<:fullstar:1387609456824680528>'
      });
      const eraLine = showEraFor.has((card.category || '').toLowerCase()) && card.era
        ? `\n• Era: ${card.era}`
        : '';

      cardLines.push(
        `${stars} **${card.name}**\n` +
        `• Group: ${card.group}${eraLine}\n` +
        `• Code: \`${card.cardCode}\``
      );

      pulled.push(card);
    }

    if (!pulled.length) {
      return safeReply(interaction, { content: 'No cards could be pulled at this time.' });
    }

    // ✅ Inventory write (InventoryItem): bulk upsert the 3 cards
    const counts = {};
    for (const c of pulled) counts[c.cardCode] = (counts[c.cardCode] || 0) + 1;

    const ops = Object.entries(counts).map(([code, n]) => ({
      updateOne: {
        filter: { userId, cardCode: code },
        update: { $setOnInsert: { userId, cardCode: code }, $inc: { quantity: n } },
        upsert: true
      }
    }));
    if (ops.length) await InventoryItem.bulkWrite(ops, { ordered: false });

    // Currency rewards
    const patterns = getRandomInt(7500, 9500);
    const user = await giveCurrency(userId, { patterns });

    // Embeds
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
          `\nYour balance:\n• Patterns: ${user.patterns}`
        ].join('\n'))
        .setColor('#f9a825')
    ];

    // Audit
    await UserRecord.create({
      userId,
      type: 'vote',
      detail: `Voted & received 3 cards + ${patterns} patterns`
    });

    return safeReply(interaction, { embeds });
  }
};