const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const UserCurrency = require('../../../models/User');
const UserInventory = require('../../../models/UserInventory');
const UserRecord = require('../../../models/UserRecord');
const Card = require('../../../models/Card');
const generateStars = require('../../../utils/starGenerator');
const awaitUserButton = require('../../../utils/awaitUserButton');
const BoutiqueCooldown = require('../../../models/BoutiqueCooldown');
const safeReply = require('../../../utils/safeReply');
const rarityWeights = {
  '5': 0.01,
  '4': 0.11,
  '3': 0.20,
  '2': 0.28,
  '1': 0.40
};

module.exports = async function(interaction) {
    await interaction.deferReply();
    const userId = interaction.user.id;
    const shopType = interaction.options.getString('shop');
    const amount = interaction.options.getInteger('amount');

    const cooldown = await BoutiqueCooldown.findOne({ userId: interaction.user.id });
    const now = new Date();

if (cooldown && cooldown.expiresAt > now) {
  const remaining = Math.ceil((cooldown.expiresAt - now) / 1000);
  return safeReply(interaction, { content: `Please wait ${remaining} more seconds before using this again.` });
}

await BoutiqueCooldown.findOneAndUpdate(
  { userId: interaction.user.id },
  { expiresAt: new Date(now.getTime() + 60 * 1000) }, // 1 minute
  { upsert: true }
);

    // ➖ Load currency
    const currency = await UserCurrency.findOne({ userId });
    if (!currency) return safeReply(interaction, 'No currency account found.');
    // ➖ Determine cost
    let patternCost = 0, sopopCost = 0;
    if (shopType === 'random20') patternCost = 12500 * amount;
    if (shopType === 'choice10') patternCost = 8500 * amount;
    if (shopType === 'special') sopopCost = 2 * amount;

    if (currency.patterns < patternCost) {
      return safeReply(interaction, `You need ${patternCost} Patterns (have ${currency.patterns}).`);
    }
    if (currency.sopop < sopopCost) {
      return safeReply(interaction, `You need ${sopopCost} Sopop${sopopCost > 1 ? 's' : ''} (have ${currency.sopop}).`);
    }

    // ➖ Shared vars for results
    const pulls = []; // stores Card docs
    let filter;

    // *******************
    // 🌀 Shop Logic Sections
    // *******************

    // random20
    if (shopType === 'random20') {
      filter = { pullable: true, category: { $nin: ['event', 'zodiac', 'others'] } };
      const pool = await Card.find(filter);
      const fives = pool.filter(c => c.rarity === 5);
      if (pool.length < 20 || fives.length === 0) {
        return safeReply(interaction, 'Not enough cards in database for random20.');
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

  const filters = [
    { pullable: true },
    { category: { $nin: ['event', 'zodiac', 'others'] } }
  ];

  const buildExpr = (field, values) => ({
    $expr: {
      $in: [
        { $toLower: `$${field}` },
        values.map(v => v.toLowerCase())
      ]
    }
  });

  if (rawGroups) filters.push(buildExpr('group', rawGroups.split(',').map(s => s.trim())));
  if (rawNames) filters.push(buildExpr('name', rawNames.split(',').map(s => s.trim())));
  if (rawEras) filters.push(buildExpr('era', rawEras.split(',').map(s => s.trim())));

  const pool = await Card.find({ $and: filters });

  // 🎯 New check: only drop 5⭐ if at least one card with rarity 1–4 exists
  const hasOnlyRarity5 = pool.every(c => c.rarity === 5);

if (hasOnlyRarity5) {
  return safeReply(interaction, 'Only 5 Star cards found — must be at least one 1–4 Star cards to use this shop.');
}

  if (pool.length === 0) {
    return safeReply(interaction, 'No cards match those filters.');
  }

  for (let i = 0; i < amount * 10; i++) {
    const randomCard = getWeightedRandomCard(pool);
    pulls.push(randomCard);
  }

  if (pulls.length === 0) {
    return safeReply(interaction, 'No valid cards were pulled, no charges applied.');
  }
}

// ➖ Deduct currency & log transaction
    currency.patterns -= patternCost;
    currency.sopop -= sopopCost;
    await currency.save();
    await UserRecord.create({
      userId,
      type: 'cardboutique',
      detail: `Spent ${patternCost} Patterns & ${sopopCost} Sopop on ${shopType} x${amount}`
    });

    // special
    if (shopType === 'special') {
      filter = { pullable: true, category: { $in: ['event', 'zodiac'] } };
      const pool = await Card.find(filter);
      if (pool.length === 0) {
  return safeReply(interaction, 'No special cards found for that filter.');
}

for (let i = 0; i < amount; i++) {
  const pick = pool[Math.floor(Math.random() * pool.length)];
  pulls.push(pick);
}
    }

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
          type: 'boutiquecard',
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
        return `• ${generateStars({ rarity: g.card.rarity, overrideEmoji: g.card.emoji })} \`${g.card.cardCode}\` — x${g.qty} [Total: ${total}]`;
      }).join('\n');

      return new EmbedBuilder()
        .setTitle(`Boutique Card Results`)
        .setColor('#009688')
        .setDescription(desc)
        .addFields(
          { name: 'Total Cards', value: `${totalCards}`, inline: true },
          { name: 'Total <:fullstar:1387609456824680528>', value: `${totalStars}`, inline: true }
        )
        .setFooter({ text: `Page ${current + 1} of ${totalPages}` });
    };
    const renderRow = () => new ActionRowBuilder().addComponents(
                      new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary).setDisabled(current === 0).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
                      new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary).setDisabled(current === 0).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
                      new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary).setDisabled(current >= totalPages - 1).setEmoji({ id: '1390462706544410704', name: ':ehx_rightarrow' }),
                      new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary).setDisabled(current >= totalPages - 1).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
                    );
                
                    await safeReply(interaction, { embeds: [await renderEmbed(current)], components: [renderRow()] });
                
                    while (true) {
                      const btn = await awaitUserButton(interaction, interaction.user.id, ['first', 'prev', 'next', 'last'], 120000);
                      if (!btn) break;
                
                      if (btn.customId === 'first') current = 0;
                      if (btn.customId === 'prev') current = Math.max(0, current - 1);
                      if (btn.customId === 'next') current = Math.min(totalPages - 1, current + 1);
                      if (btn.customId === 'last') current = totalPages - 1;
                
                      await safeReply(interaction, { embeds: [renderEmbed(current)], components: [renderRow()] });
                    }
                
                    // Final cleanup
                    try {
                      await safeReply(interaction, { components: [] });
                    } catch (err) {
                      console.warn('Pagination cleanup failed:', err.message);
                    }
                  };
                