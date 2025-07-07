const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserInventory = require('../models/UserInventory');
const getRandomCardByRarity = require('../utils/randomCardFromRarity');
const pickRarity = require('../utils/rarityPicker');
const generateStars = require('../utils/starGenerator');
const cooldowns = require('../utils/cooldownConfig');
const { isOnCooldown, getCooldownTimestamp, setCooldown } = require('../utils/cooldownManager');
const handleReminders = require('../utils/reminderHandler'); // ✅ Import this
const User = require('../models/User');
const UserRecord = require('../models/UserRecord');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pull')
    .setDescription('Pull a random card from any pullable category')
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
    const commandName = 'pull';
    
    const cooldownDuration = cooldowns[commandName];
  if (!cooldownDuration) {
    console.warn(`Cooldown not defined for command: ${commandName}`);
    return; // Or skip cooldown logic
  }

    // 🔎 Check if user has booster role
  const boosterRoleId = '1387230787929243780';
  const hasBooster = interaction.member.roles.cache.has(boosterRoleId);

// ⏱ Calculate correct cooldown
  const cooldownMs = typeof cooldownDuration === 'object'
  ? (hasBooster ? cooldownDuration.booster : cooldownDuration.default)
  : cooldownDuration;

    // 🔒 Cooldown check
    if (isOnCooldown(userId, commandName)) {
      const nextTime = getCooldownTimestamp(userId, commandName, cooldownMs);
      return interaction.reply({
        content: `You must wait ${nextTime} before using \`/pull\` again.`,
        
      });
    }

    // ✅ Set cooldown
    setCooldown(userId, commandName, cooldownMs);

    await interaction.deferReply();

    const rarity = pickRarity();
    const card = await getRandomCardByRarity(rarity);

    if (!card) {
      return interaction.editReply({ content: `No pullable cards found for rarity ${rarity}.` });
    }

    let userInventory = await UserInventory.findOne({ userId });
    if (!userInventory) {
      userInventory = await UserInventory.create({ userId, cards: [] });
    }

    const existing = (userInventory.cards || []).find(c => c.cardCode === card.cardCode);
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

    const lines = [
      `**Group:** ${card.group}`,
      `**Name:** ${card.name}`,
      ...(card.category.toLowerCase() === 'kpop' ? [`**Era:** ${card.era}`] : []),
      `**Code:** \`${card.cardCode}\``,
      `**Copies:** ${copies}`
    ];

    const pulledReadable = new Date().toUTCString();

    const embed = new EmbedBuilder()
      .setTitle(stars)
      .setDescription(lines.join('\n'))
      .setImage(card.discordPermLinkImage || card.imgurImageLink)
      .setFooter({ text: `Pulled ${pulledReadable}` });

    // ✅ Handle reminders via utility
    await handleReminders(interaction, commandName, cooldownMs);

    await UserRecord.create({
  userId: userId,
  type: 'pull',
  detail: `Pulled ${card.name} (${card.cardCode}) [${card.rarity}]`
});

    return interaction.editReply({ embeds: [embed] });
  }
};