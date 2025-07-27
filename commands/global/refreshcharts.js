const { SlashCommandBuilder } = require('discord.js');
const ChartSnapshot = require('../../models/ChartSnapshot');
const UserInventory = require('../../models/UserInventory');
const Card = require('../../models/Card');
const ChartCooldown = require('../../models/RefreshCooldown');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refreshcharts')
    .setDescription('Refresh your chart stats'),

  async execute(interaction) {
    await interaction.deferReply();

    const userId = interaction.user.id;
    const now = new Date();
    const cooldownLimit = 30 * 60 * 1000; // 30 minutes

    const cooldownDoc = await ChartCooldown.findOne({ userId });

    if (cooldownDoc) {
      const timePassed = now - cooldownDoc.lastUsed;
      if (timePassed < cooldownLimit) {
        const remaining = Math.ceil((cooldownLimit - timePassed) / 60000);
        return interaction.editReply({ content: `Please wait ${remaining} more minute(s) before refreshing again.` });
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
      return interaction.editReply({ content: 'You have no cards to calculate.' });
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

// Save 'all' snapshot
await ChartSnapshot.findOneAndUpdate(
  { userId, filterType: 'all', filterValue: '' },
  { totalCards, totalStars, updatedAt: now },
  { upsert: true }
);

// Save group-based snapshots
const groups = [...new Set(allCards.map(c => c.group).filter(Boolean))];
for (const group of groups) {
  let groupTotalCards = 0;
  let groupTotalStars = 0;

  for (const entry of inv.cards) {
    const card = allCards.find(c => c.cardCode === entry.cardCode && c.group === group);
    if (card) {
      groupTotalCards += entry.quantity;
      groupTotalStars += card.rarity * entry.quantity;
    }
  }

  await ChartSnapshot.findOneAndUpdate(
    { userId, filterType: 'group', filterValue: group },
    { totalCards: groupTotalCards, totalStars: groupTotalStars, updatedAt: now },
    { upsert: true }
  );
}

const names = [...new Set(allCards.map(c => c.name).filter(Boolean))];
for (const name of names) {
  let nameTotalCards = 0;
  let nameTotalStars = 0;

  for (const entry of inv.cards) {
    const card = allCards.find(c => c.cardCode === entry.cardCode && c.name === name);
    if (card) {
      nameTotalCards += entry.quantity;
      nameTotalStars += card.rarity * entry.quantity;
    }
  }

  await ChartSnapshot.findOneAndUpdate(
    { userId, filterType: 'name', filterValue: name },
    { totalCards: nameTotalCards, totalStars: nameTotalStars, updatedAt: now },
    { upsert: true }
  );
}

const eras = [...new Set(allCards.map(c => c.era).filter(Boolean))];
for (const era of eras) {
  let eraTotalCards = 0;
  let eraTotalStars = 0;

  for (const entry of inv.cards) {
    const card = allCards.find(c => c.cardCode === entry.cardCode && c.era === era);
    if (card) {
      eraTotalCards += entry.quantity;
      eraTotalStars += card.rarity * entry.quantity;
    }
  }

  await ChartSnapshot.findOneAndUpdate(
    { userId, filterType: 'era', filterValue: era },
    { totalCards: eraTotalCards, totalStars: eraTotalStars, updatedAt: now },
    { upsert: true }
  );
}

    return interaction.editReply({ content: 'Your chart stats have been refreshed!' });
  }
};