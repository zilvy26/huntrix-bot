const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserInventory = require('../models/UserInventory');
const getRandomCardByRarity = require('../utils/randomCardFromRarity');
const pickRarity = require('../utils/rarityPicker');
const generateStars = require('../utils/starGenerator');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pull')
    .setDescription('Pull a random card from any pullable category'),

  async execute(interaction) {
    await interaction.deferReply();

    const userId = interaction.user.id;
    const rarity = pickRarity();

    // ✅ Use your utility for fetching a card
    const card = await getRandomCardByRarity(rarity);
    if (!card) {
      return interaction.editReply({ content: `❌ No pullable cards found for rarity ${rarity}.` });
    }

    // ✅ Update inventory
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

    // ✅ Build the embed
    const stars = generateStars({
  rarity: card.rarity,
  overrideEmoji: card.emoji || '<:fullstar:1387609456824680528>'
});

const now = Math.floor(Date.now() / 1000);

const lines = [
  `**Group:** ${card.group}`,
  `**Name:** ${card.name}`,
  ...(card.category.toLowerCase() === 'kpop' ? [`**Era:** ${card.era}`] : []),
  `**Code:**\`${card.cardCode}\``,
  `**Copies:** ${copies}`
];

const embed = new EmbedBuilder()
  .setTitle(stars)
  .setDescription(lines.join('\n'))
  .setImage(card.discordPermLinkImage || card.imgurImageLink)
  .setFooter({ text:`Pulled on ${new Date().toUTCString()}`});

    return interaction.editReply({ embeds: [embed] });
  }
};