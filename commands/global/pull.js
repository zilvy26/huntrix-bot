// commands/global/pull.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserInventory = require('../../models/UserInventory');
const getRandomCardByRarity = require('../../utils/randomCardFromRarity');
const pickRarity = require('../../utils/rarityPicker');
const generateStars = require('../../utils/starGenerator');
const cooldowns = require('../../utils/cooldownManager');
const handleReminders = require('../../utils/reminderHandler');
const UserRecord = require('../../models/UserRecord');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pull')
    .setDescription('Pull a random card from any pullable category')
    .addBooleanOption(opt =>
      opt.setName('reminder').setDescription('Remind you when cooldown ends'))
    .addBooleanOption(opt =>
      opt.setName('remindinchannel').setDescription('Remind in the command channel instead of DM')),

  async execute(interaction) {
    const userId = interaction.user.id;
    const commandName = 'Pull';

    // Cooldown
    const cooldownMs = await cooldowns.getEffectiveCooldown(interaction, commandName);
    if (await cooldowns.isOnCooldown(userId, commandName)) {
      const nextTime = await cooldowns.getCooldownTimestamp(userId, commandName);
      return safeReply(interaction, { content: `You must wait ${nextTime} before using \`/pull\` again.` });
    }
    await cooldowns.setCooldown(userId, commandName, cooldownMs);

    // RNG
    const rarity = await pickRarity();
    const card = await getRandomCardByRarity(rarity);
    if (!card) {
      return safeReply(interaction, { content: `No pullable cards found for rarity ${rarity}.` });
    }

    // Atomic inventory update
    let copies = 1;
    const res = await UserInventory.updateOne(
      { userId, "cards.cardCode": card.cardCode },
      { $inc: { "cards.$.quantity": 1 } }
    );

    if (res.matchedCount === 0) {
      // Push new card if not found
      await UserInventory.updateOne(
        { userId },
        { $push: { cards: { cardCode: card.cardCode, quantity: 1 } } },
        { upsert: true }
      );
      copies = 1;
    } else {
      // Need to read back the current count
      const doc = await UserInventory.findOne(
        { userId, "cards.cardCode": card.cardCode },
        { "cards.$": 1 }
      ).lean();
      copies = doc?.cards?.[0]?.quantity ?? 1;
    }

    // Embed
    const stars = generateStars({ rarity: card.rarity, overrideEmoji: card.emoji || '<:fullstar:1387609456824680528>' });
    const imageSource = card.localImagePath ? `attachment://${card._id}.png`
      : (card.discordPermalinkImage || card.imgurImageLink);
    const files = card.localImagePath ? [{ attachment: card.localImagePath, name: `${card._id}.png` }] : [];

    const embed = new EmbedBuilder()
      .setTitle(stars)
      .setDescription([
        `**Group:** ${card.group}`,
        `**Name:** ${card.name}`,
        ...(card.category?.toLowerCase() === 'kpop' ? [`**Era:** ${card.era}`] : []),
        `**Code:** \`${card.cardCode}\``,
        `**Copies:** ${copies}`
      ].join('\n'))
      .setImage(imageSource)
      .setFooter({ text: `Pulled ${new Date().toUTCString()}` });

    try { await handleReminders(interaction, commandName, cooldownMs); } catch {}
    try {
      await UserRecord.create({
        userId, type: 'pull',
        detail: `Pulled ${card.name} (${card.cardCode}) [${card.rarity}]`
      });
    } catch {}

    return safeReply(interaction, { embeds: [embed], files });
  }
};