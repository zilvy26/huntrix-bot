const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const UserCurrency = require('../models/User');
const UserInventory = require('../models/UserInventory');
const UserRecord = require('../models/UserRecord');
const Card = require('../models/Card');
const generateStars = require('../utils/starGenerator');
const awaitUserButton = require('../utils/awaitUserButton');
const BoutiqueCooldown = require('../models/BoutiqueCooldown');
const rarityWeights = {
  '5': 0.01,
  '4': 0.11,
  '3': 0.20,
  '2': 0.28,
  '1': 0.40
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cardboutique')
    .setDescription('Spend Patterns or Sopops for card pulls')
    .addStringOption(opt =>
      opt.setName('shop')
        .setDescription('Choose a shop pull type')
        .setRequired(true)
        .addChoices(
          { name: '20 Random & Guaranteed 5S | 10K Patterns', value: 'random20' },
          { name: '10 Chosen | 6K Patterns', value: 'choice10' },
          { name: 'Special Pull | 1K Patterns & 1 Sopop', value: 'special' }
        ))
    .addIntegerOption(opt =>
      opt.setName('amount')
        .setDescription('How many pulls (1–50)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(50))
    // *** For choice10 filters ***
    .addStringOption(opt =>
      opt.setName('groups')
        .setDescription('Comma‑separated groups'))
    .addStringOption(opt =>
      opt.setName('names')
        .setDescription('Comma‑separated names'))
    .addStringOption(opt =>
      opt.setName('eras')
        .setDescription('Comma‑separated eras')),

  async execute(interaction) {
    await interaction.deferReply();
    const userId = interaction.user.id;
    const shopType = interaction.options.getString('shop');
    const amount = interaction.options.getInteger('amount');

    const cooldown = await BoutiqueCooldown.findOne({ userId: interaction.user.id });
    const now = new Date();

if (cooldown && cooldown.expiresAt > now) {
  const remaining = Math.ceil((cooldown.expiresAt - now) / 1000);
  return interaction.editReply({ content: `Please wait ${remaining} more seconds before using this again.` });
}

await BoutiqueCooldown.findOneAndUpdate(
  { userId: interaction.user.id },
  { expiresAt: new Date(now.getTime() + 2 * 60 * 1000) }, // 2 minutes
  { upsert: true }
);

    // ➖ Load currency
    const currency = await UserCurrency.findOne({ userId });
    if (!currency) return interaction.editReply('❌ No currency account found.');
    // ➖ Determine cost
    let patternCost = 0, sopopCost = 0;
    if (shopType === 'random20') patternCost = 10000 * amount;
    if (shopType === 'choice10') patternCost = 6000 * amount;
    if (shopType === 'special') {
      patternCost = 1000 * amount;
      sopopCost = 1 * amount;
    }

    if (currency.patterns < patternCost) {
      return interaction.editReply(`❌ You need ${patternCost} Patterns (have ${currency.patterns}).`);
    }
    if (currency.sopops < sopopCost) {
      return interaction.editReply(`❌ You need ${sopopCost} Sopop${sopopCost > 1 ? 's' : ''} (have ${currency.sopops}).`);
    }

    // ➖ Deduct currency & log transaction
    currency.patterns -= patternCost;
    currency.sopops -= sopopCost;
    await currency.save();
    await UserRecord.create({
      userId,
      type: 'cardboutique',
      detail: `Spent ${patternCost} Patterns & ${sopopCost} Sopops on ${shopType} x${amount}`
    });

    function getWeightedRandomCard(cards) {
  const pool = [];

  for (const card of cards) {
    const weight = rarityWeights[card.rarity] || 0.01;
    for (let i = 0; i < Math.floor(weight * 100); i++) {
      pool.push(card);
    }
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

    // ➖ Shared vars for results
    const pulls = []; // stores Card docs
    let filter;

    // *******************
    // 🌀 Shop Logic Sections
    // *******************

    // random20
    if (shopType === 'random20') {
      filter = { pullable: true, category: { $nin: ['EVENT', 'ZODIAC', 'OTHERS'] } };
      const pool = await Card.find(filter);
      const fives = pool.filter(c => c.rarity === 5);
      if (pool.length < 20 || fives.length === 0) {
        return interaction.editReply('❌ Not enough cards in database for random20.');
      }
      for (let i = 0; i < amount; i++) {
        const guaranteed = fives[Math.floor(Math.random() * fives.length)];
        const others = [];
        while (others.length < 19) {
          const randomCard = getWeightedRandomCard(pool);
          others.push(randomCard);
        }
        pulls.push(guaranteed, ...others);
      }
    }

    // choice10
    if (shopType === 'choice10') {
      const rawGroups = interaction.options.getString('groups');
      const rawNames = interaction.options.getString('names');
      const rawEras = interaction.options.getString('eras');

      filter = { pullable: true };

      if (rawGroups) filter.group = { $in: rawGroups.split(',').map(s => new RegExp(s.trim(), 'i')) };
      if (rawNames) filter.name = { $in: rawNames.split(',').map(s => new RegExp(s.trim(), 'i')) };
      if (rawEras) filter.era = { $in: rawEras.split(',').map(s => new RegExp(s.trim(), 'i')) };
      const pool = await Card.find(filter);
      if (pool.length === 0) {
  return interaction.editReply('❌ No cards match those filters.');
}

for (let i = 0; i < amount * 10; i++) {
  const randomCard = getWeightedRandomCard(pool);
  pulls.push(randomCard);
}
    }

    // special
    if (shopType === 'special') {
      filter = { pullable: true, category: { $in: ['EVENT', 'ZODIAC'] } };
      const pool = await Card.find(filter);
      if (pool.length === 0) {
  return interaction.editReply('❌ No special cards found for that filter.');
}

for (let i = 0; i < amount; i++) {
  const pick = pool[Math.floor(Math.random() * pool.length)];
  pulls.push(pick);
}
    }

    // ➖ Process pulls: stack, update inventory & records
    const counts = {};
    pulls.forEach(c => {
      counts[c.cardCode] = (counts[c.cardCode] || { card: c, qty: 0 });
      counts[c.cardCode].qty++;
    });

    const inv = await UserInventory.findOne({ userId }) || await UserInventory.create({ userId, cards: [] });
    for (const [code, info] of Object.entries(counts)) {
      const existing = inv.cards.find(x => x.cardCode === code);
      if (existing) existing.quantity += info.qty;
      else inv.cards.push({ cardCode: code, quantity: info.qty });

      // Log each card grant
      for (let i = 0; i < info.qty; i++) {
        await UserRecord.create({
          userId,
          type: 'cardboutique',
          detail: `Granted ${info.card.name} (${code}) [${info.card.rarity}] via ${shopType}`
        });
      }
    }
    await inv.save();

    // ➖ Setup pagination embed & buttons
    const granted = Object.values(counts);
    granted.sort((a, b) => b.card.rarity - a.card.rarity);
    let current = 0;
    const perPage = 5;
    const totalPages = Math.ceil(granted.length / perPage);
    const totalCards = pulls.length;
    const totalStars = pulls.reduce((sum, c) => sum + c.rarity, 0);

    const renderEmbed = () => {
      const items = granted.slice(current * perPage, (current + 1) * perPage);
      const desc = items.map(g => {
        const total = inv.cards.find(x => x.cardCode === g.card.cardCode)?.quantity;
        return `• ${generateStars({ rarity: g.card.rarity })} \`${g.card.cardCode}\` — x${g.qty} [Total: ${total}]`;
      }).join('\n');

      return new EmbedBuilder()
        .setTitle(`Card Boutique Results`)
        .setColor('#009688')
        .setDescription(desc)
        .addFields(
          { name: 'Total Cards', value: `${totalCards}`, inline: true },
          { name: 'Total <:fullstar:1387609456824680528>', value: `${totalStars}`, inline: true }
        )
        .setFooter({ text: `Page ${current + 1} of ${totalPages}` });
    };
    const renderRow = () => new ActionRowBuilder().addComponents(
                      new ButtonBuilder().setCustomId('first').setLabel('⏮ First').setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
                      new ButtonBuilder().setCustomId('prev').setLabel('◀ Back').setStyle(ButtonStyle.Primary).setDisabled(current === 0),
                      new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(current >= totalPages - 1),
                      new ButtonBuilder().setCustomId('last').setLabel('Last ⏭').setStyle(ButtonStyle.Secondary).setDisabled(current >= totalPages - 1)
                    );
                
                    await interaction.editReply({ embeds: [await renderEmbed(current)], components: [renderRow()] });
                
                    while (true) {
                      const btn = await awaitUserButton(interaction, interaction.user.id, ['first', 'prev', 'next', 'last'], 120000);
                      if (!btn) break;
                
                      if (btn.customId === 'first') current = 0;
                      if (btn.customId === 'prev') current = Math.max(0, current - 1);
                      if (btn.customId === 'next') current = Math.min(totalPages - 1, current + 1);
                      if (btn.customId === 'last') current = totalPages - 1;
                
                      await interaction.editReply({ embeds: [renderEmbed(current)], components: [renderRow()] });
                    }
                
                    // Final cleanup
                    try {
                      await interaction.editReply({ components: [] });
                    } catch (err) {
                      console.warn('Pagination cleanup failed:', err.message);
                    }
                  }
                };