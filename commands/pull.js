const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserInventory = require('../models/UserInventory');
const getRandomCardByRarity = require('../utils/randomCardFromRarity');
const pickRarity = require('../utils/rarityPicker');
const generateStars = require('../utils/starGenerator');
const cooldowns = require('../utils/cooldownManager');
const cooldownConfig = require('../utils/cooldownConfig');
const handleReminders = require('../utils/reminderHandler');
const User = require('../models/User');
const UserRecord = require('../models/UserRecord');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pull')
    .setDescription('Pull a random card from any pullable category')
    .addBooleanOption(opt =>
      opt.setName('reminder').setDescription('Remind you when cooldown ends').setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('remindinchannel').setDescription('Remind in the command channel instead of DM').setRequired(false)),

  async execute(interaction) {
    const userId = interaction.user.id;
    const commandName = 'Pull';

    const cooldownMs = await cooldowns.getEffectiveCooldown(interaction, commandName);

    if (await cooldowns.isOnCooldown(userId, commandName)) {
      const nextTime = await cooldowns.getCooldownTimestamp(userId, commandName);
      return interaction.reply({
        content: `You must wait ${nextTime} before using \`/pull\` again.`,
      });
    }

    await cooldowns.setCooldown(userId, commandName, cooldownMs);
    await interaction.deferReply();

    const rarity = pickRarity();
    const card = await getRandomCardByRarity(rarity);

    if (!card) {
      return interaction.editReply({ content: `No pullable cards found for rarity ${rarity}.` });
    }

    let userInventory = await UserInventory.findOne({ userId });
    if (!userInventory) userInventory = await UserInventory.create({ userId, cards: [] });

    const existing = userInventory.cards.find(c => c.cardCode === card.cardCode);
    let copies = 1;

    if (existing) {
      existing.quantity += 1;
      copies = existing.quantity;
    } else {
      userInventory.cards.push({ cardCode: card.cardCode, quantity: 1 });
    }

    await userInventory.save();

    const stars = generateStars({
      rarity: card.rarity,
      overrideEmoji: card.emoji || '<:fullstar:1387609456824680528>'
    });

    const imageSource = card.localImagePath
  ? `attachment://${card._id}.png`
  : card.discordPermalinkImage || card.imgurImageLink;

  const files = card.localImagePath
  ? [{ attachment: card.localImagePath, name: `${card._id}.png` }]
  : [];

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

    await handleReminders(interaction, commandName, cooldownMs);

    await UserRecord.create({
      userId,
      type: 'pull',
      detail: `Pulled ${card.name} (${card.cardCode}) [${card.rarity}]`
    });

    return interaction.editReply({ embeds: [embed], files });
  }
};