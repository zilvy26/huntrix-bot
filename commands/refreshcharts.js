const { SlashCommandBuilder } = require('discord.js');
const Chart = require('../models/Chart');
const UserInventory = require('../models/UserInventory');
const Card = require('../models/Card');
const ChartCooldown = require('../models/RefreshCooldown');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refreshcharts')
    .setDescription('Refresh your chart stats'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = new Date();
    const cooldownLimit = 60 * 60 * 1000; // 1 hour

    const cooldownDoc = await ChartCooldown.findOne({ userId });

    if (cooldownDoc) {
      const timePassed = now - cooldownDoc.lastUsed;
      if (timePassed < cooldownLimit) {
        const remaining = Math.ceil((cooldownLimit - timePassed) / 60000);
        return interaction.reply({ content: `Please wait ${remaining} more minute(s) before refreshing again.` });
      }
    }

    // Save new cooldown timestamp
    await ChartCooldown.findOneAndUpdate(
      { userId },
      { lastUsed: now },
      { upsert: true }
    );

    const inv = await UserInventory.findOne({ userId });
    if (!inv || inv.cards.length === 0) {
      return interaction.reply({ content: 'You have no cards to calculate.' });
    }

    const allCardCodes = inv.cards.map(c => c.cardCode);
    const allCards = await Card.find({ cardCode: { $in: allCardCodes } });

    let totalCards = 0;
    let totalStars = 0;

    for (const entry of inv.cards) {
      const card = allCards.find(c => c.cardCode === entry.cardCode);
      if (card) {
        totalCards += entry.quantity;
        totalStars += card.rarity * entry.quantity;
      }
    }

    await Chart.findOneAndUpdate(
      { userId },
      { totalCards, totalStars, updatedAt: now },
      { upsert: true }
    );

    return interaction.reply({ content: 'Your chart stats have been refreshed!' });
  }
};