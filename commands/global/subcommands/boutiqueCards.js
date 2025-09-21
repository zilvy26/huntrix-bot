const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const UserCurrency = require('../../../models/User');
const UserRecord = require('../../../models/UserRecord');
const Card = require('../../../models/Card');
const InventoryItem = require('../../../models/InventoryItem'); // ✅ NEW
const generateStars = require('../../../utils/starGenerator');
const awaitUserButton = require('../../../utils/awaitUserButton');
const BoutiqueCooldown = require('../../../models/BoutiqueCooldown');
const { safeReply, safeDefer } = require('../../../utils/safeReply');

const rarityWeights = {
  '1': 0.36,
  '2': 0.2955,
  '3': 0.2045,
  '4': 0.12,
  '5': 0.02,
};

module.exports = async function(interaction) {
  await safeDefer(interaction);
  const userId = interaction.user.id;
  const shopType = interaction.options.getString('shop');
  const amount = interaction.options.getInteger('amount');

  const rawGroups = interaction.options.getString('groups');
const rawNames  = interaction.options.getString('names');
const rawEras   = interaction.options.getString('eras');

// helper: true if the option is a non-empty, non-whitespace string
const hasText = (s) => typeof s === 'string' && s.trim().length > 0;

// if ANY filter is used AND this isn’t choice10 → block early (no deduction)
const filtersUsed = hasText(rawGroups) || hasText(rawNames) || hasText(rawEras);
if (shopType !== 'choice10' && filtersUsed) {
  return safeReply(interaction, {
    content: 'Filters can only be used with **10x Cards of Choice**.',
    ephemeral: true
  });
}

  // --- simple 30s cooldown for this command ---
  const cooldown = await BoutiqueCooldown.findOne({ userId: interaction.user.id });
  const now = new Date();

  if (cooldown && cooldown.expiresAt > now) {
    const remaining = Math.ceil((cooldown.expiresAt - now) / 1000);
    return safeReply(interaction, { content: `Please wait ${remaining} more seconds before using this again.` });
  }

  await BoutiqueCooldown.findOneAndUpdate(
    { userId: interaction.user.id },
    { expiresAt: new Date(now.getTime() + 30 * 1000) }, // 30 seconds
    { upsert: true }
  );

  // ➖ Load currency
  const currency = await UserCurrency.findOne({ userId });
  if (!currency) return safeReply(interaction, 'No currency account found.');

  // ➖ Determine cost
  let patternCost = 0, sopopCost = 0;
  if (shopType === 'random20') patternCost = 12500 * amount;
  if (shopType === 'choice10') patternCost = 8500 * amount;
  if (shopType === 'zodiac1') sopopCost = 4 * amount;
  if (shopType === 'event1')  sopopCost = 4 * amount;

  if (currency.patterns < patternCost) {
    return safeReply(interaction, `You need ${patternCost} Patterns (have ${currency.patterns}).`);
  }
  if (currency.sopop < sopopCost) {
    return safeReply(interaction, `You need ${sopopCost} Sopop${sopopCost > 1 ? 's' : ''} (have ${currency.sopop}).`);
  }

  // ➖ Pull logic
  const pulls = []; // stores Card docs
  let filter;

  // random20 (1 guaranteed 5⭐ + 19 weighted)
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

  // choice10 (weighted 10x with filters)
  if (shopType === 'choice10') {

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
    if (rawNames)  filters.push(buildExpr('name',  rawNames .split(',').map(s => s.trim())));
    if (rawEras)   filters.push(buildExpr('era',   rawEras  .split(',').map(s => s.trim())));

    const pool = await Card.find({ $and: filters });

    // Must have at least one non-5⭐ in pool
    const hasOnlyRarity5 = pool.length > 0 && pool.every(c => c.rarity === 5);
    if (hasOnlyRarity5) {
      return safeReply(interaction, 'Only 5 Star cards found — must be at least one 1–4 Star card to use this shop.');
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

  // zodiac1
  if (shopType === 'zodiac1') {
    filter = { pullable: true, category: 'zodiac' };
    const pool = await Card.find(filter);
    if (pool.length === 0) {
      return safeReply(interaction, 'No zodiac cards found for that filter.');
    }
    for (let i = 0; i < amount; i++) {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      pulls.push(pick);
    }
  }

  // event1
  if (shopType === 'event1') {
    filter = { pullable: true, category: 'event' };
    const pool = await Card.find(filter);
    if (pool.length === 0) {
      return safeReply(interaction, 'No event cards found for that filter.');
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
      for (let i = 0; i < Math.floor(weight * 100); i++) pool.push(card);
    }
    return pool[Math.floor(Math.random() * pool.length)];
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

  // ================================
  // ✅ Inventory write: InventoryItem
  // ================================
  // Stack pulls: { code -> { card, qty } }
  const counts = {};
  for (const c of pulls) {
    counts[c.cardCode] = (counts[c.cardCode] || { card: c, qty: 0 });
    counts[c.cardCode].qty++;
  }

  // 1) Bulk upsert increments
  const ops = [];
  for (const [code, info] of Object.entries(counts)) {
    ops.push({
      updateOne: {
        filter: { userId, cardCode: code },
        update: { $setOnInsert: { userId, cardCode: code }, $inc: { quantity: info.qty } },
        upsert: true
      }
    });
  }
  if (ops.length) await InventoryItem.bulkWrite(ops, { ordered: false });

  // 2) Read back updated totals for these codes (for the embed)
  const codes = Object.keys(counts);
  const updatedDocs = await InventoryItem.find(
    { userId, cardCode: { $in: codes } },
    { cardCode: 1, quantity: 1, _id: 0 }
  ).lean();
  const qtyMap = Object.fromEntries(updatedDocs.map(d => [d.cardCode, d.quantity]));

  // 3) Log each card grant (unchanged behavior)
  for (const [code, info] of Object.entries(counts)) {
    for (let i = 0; i < info.qty; i++) {
      await UserRecord.create({
        userId,
        type: 'boutiquecard',
        detail: `Granted ${info.card.name} (${code}) [${info.card.rarity}] via ${shopType}`
      });
    }
  }

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
      const total = qtyMap[g.card.cardCode] ?? 0; // ✅ use updated totals
      return `• ${generateStars({ rarity: g.card.rarity, overrideEmoji: g.card.emoji })} **${g.card.name}** \`${g.card.cardCode}\` — x${g.qty} [Total: ${total}]`;
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
    new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary).setDisabled(current >= totalPages - 1).setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
    new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary).setDisabled(current >= totalPages - 1).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
    new ButtonBuilder().setCustomId('copy').setLabel('Copy Codes').setStyle(ButtonStyle.Success)
  );

  await safeReply(interaction, { embeds: [renderEmbed(current)], components: [renderRow()] });

  const pageSlice = (arr, page, perPage) =>
  arr.slice(page * perPage, (page + 1) * perPage);

  // --- Pagination loop (unchanged) ---
  while (true) {
    const btn = await awaitUserButton(interaction, interaction.user.id, ['first', 'prev', 'next', 'last', 'copy'], 120000);
    if (!btn) break;

    if (!btn.deferred && !btn.replied) {
      try { await btn.deferUpdate(); } catch {}
    }

    if (btn.customId === 'first') current = 0;
    if (btn.customId === 'prev')  current = Math.max(0, current - 1);
    if (btn.customId === 'next')  current = Math.min(totalPages - 1, current + 1);
    if (btn.customId === 'last')  current = totalPages - 1;
    if (btn.customId === 'copy') {
         const slice = pageSlice(granted, current, perPage);
    const codes = slice.map(g => g.card.cardCode).join(', ');
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `${codes}`, flags: 1 << 6 }).catch(()=>{});
        } else {
          await interaction.followUp({ content: `${codes}`, flags: 1 << 6 }).catch(()=>{});
        }
        return;
      }

    await interaction.editReply({ embeds: [renderEmbed(current)], components: [renderRow()] });
  }

  // Cleanup components when collector ends or timeout
  try { await interaction.editReply({ components: [] }); } catch (err) {
    console.warn('Pagination cleanup failed:', err.message);
  }
};
