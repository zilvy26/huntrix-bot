const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserInventory = require('../models/UserInventory');
const getRandomCardByRarity = require('../utils/randomCardFromRarity');
const pickRarity = require('../utils/rarityPicker');
const generateStars = require('../utils/starGenerator');
const cooldowns = require('../utils/cooldownConfig');
const { isOnCooldown, getCooldownTimestamp, setCooldown } = require('../utils/cooldownManager');
const handleReminders = require('../utils/reminderHandler'); // ✅ Import this
const User = require('../models/User');

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

    // 🔒 Cooldown check
    if (isOnCooldown(userId, commandName)) {
      const nextTime = getCooldownTimestamp(userId, commandName);
      return interaction.reply({
        content: `⏳ You must wait until ${nextTime} before using \`/pull\` again.`,
        
      });
    }

    await interaction.deferReply();

    const rarity = pickRarity();
    const card = await getRandomCardByRarity(rarity);

    if (!card) {
      return interaction.editReply({ content: `❌ No pullable cards found for rarity ${rarity}.` });
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

    // ✅ Set cooldown
    setCooldown(userId, commandName, cooldownDuration);

    // ✅ Handle reminders via utility
    await handleReminders(interaction, commandName, cooldownDuration);

    return interaction.editReply({ embeds: [embed] });
  }
};