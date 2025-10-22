// commands/stall/sell.js
const Card = require('../../../models/Card');
const MarketListing = require('../../../models/MarketListing');
const InventoryItem = require('../../../models/InventoryItem');
const { safeReply } = require('../../../utils/safeReply');

// ====== NEW: robust buy-code generator ======
const { customAlphabet } = require('nanoid');
// Avoid ambiguous chars; 8 chars ≈ 1e12 space
const nano = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

// Rarity-based caps (unchanged)
const RARITY_CAPS = { 1: 300, 2: 600, 3: 900, 4: 1200 };

const isSpecialR5 = (card) =>
  Number(card.rarity) === 5 &&
  ['kpop', 'anime', 'game', 'franchise'].includes(String(card.category || '').toLowerCase());

// ---- ERA CAPS CONFIG ----
const ERA_PRICE_CAPS_RAW = {
  'VIR25': 21000,
  'LEO25': 26000,
  'LIB25': 18000,
  'SCO25': 15000,
  'Candy Festival (Demo)': 23000,
  'Candy Festival (Album)': 20000,
  'Fox Tale (Demo)': 15000
};
const ERA_PRICE_CAPS = Object.fromEntries(
  Object.entries(ERA_PRICE_CAPS_RAW).map(([k, v]) => [String(k).trim().toLowerCase(), Number(v)])
);

const MAX_LISTINGS = 100;

// ---------- helpers ----------
function parseCodes(raw) {
  const batches = [];
  const needCounts = new Map();
  if (!raw) return { batches, needCounts };
  const tokens = raw.trim().split(/[\s,]+/).filter(Boolean);
  for (const t of tokens) {
    const m = t.match(/^([A-Za-z0-9-]+)(?:\+(\d+))?$/);
    if (!m) continue;
    const code = m[1].toUpperCase();
    const qty = m[2] ? Math.max(1, parseInt(m[2], 10)) : 1;
    batches.push({ code, qty });
    needCounts.set(code, (needCounts.get(code) || 0) + qty);
  }
  return { batches, needCounts };
}

function parsePrices(rawPrice, batches) {
  if (!rawPrice || typeof rawPrice !== 'string') {
    throw new Error('You must provide a price. Use a single number or a list matching each card.');
  }
  const tokens = rawPrice.trim().split(/[\s,]+/).filter(Boolean);

  if (tokens.length === 1) {
    const p = parseInt(tokens[0], 10);
    if (!Number.isFinite(p) || p <= 0) throw new Error('Price must be a positive number.');
    return Array(batches.length).fill(p);
  }
  if (tokens.length !== batches.length) {
    const missingIdx = tokens.length < batches.length ? tokens.length : -1;
    if (missingIdx >= 0) {
      const missingCode = batches[missingIdx]?.code || 'UNKNOWN';
      throw new Error(`No price provided for **${missingCode}**. Please supply the same number of prices as card entries.`);
    }
    throw new Error(`You provided more prices than cards. Please match counts exactly (${batches.length}).`);
  }

  return tokens.map((t, i) => {
    const p = parseInt(t, 10);
    if (!Number.isFinite(p) || p <= 0) {
      throw new Error(`Invalid price "${t}" for **${batches[i].code}**. Prices must be positive integers.`);
    }
    return p;
  });
}

function checkPriceCapsForCard(card, price) {
  const eraKey = String(card.era || '').trim().toLowerCase();
  const eraCap = ERA_PRICE_CAPS[eraKey];
  if (typeof eraCap === 'number' && price > eraCap) {
    return `Price cap for era **${card.era}** is **${eraCap}** <:ehx_patterns:1389584144895315978>.`;
  }
  if (Number(card.rarity) < 5) {
    const cap = RARITY_CAPS[Number(card.rarity)];
    if (cap && price > cap) {
      return `Price cap for rarity ${card.rarity} cards is **${cap}** <:ehx_patterns:1389584144895315978>.`;
    }
  }
  if (isSpecialR5(card) && price > 5000) {
    return `5 Star Standard cards are capped at **5000** <:ehx_patterns:1389584144895315978>.`;
  }
  return null;
}

// ===== NEW: create listing with unique buyCode (retries on E11000) =====
async function createListingWithUniqueCode(data, maxAttempts = 5) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const buyCode = nano();
    try {
      const doc = await MarketListing.create({ ...data, buyCode });
      return doc;
    } catch (err) {
      const msg = String(err?.message || '');
      if (err?.code === 11000 || msg.includes('E11000') || msg.includes('duplicate key')) {
        lastErr = err; // collision; retry
        continue;
      }
      throw err; // other errors: surface immediately
    }
  }
  throw new Error(`Failed to allocate unique buy code after ${maxAttempts} attempts. Last error: ${lastErr?.message || lastErr}`);
}

// ---------- handler ----------
module.exports = async function sell(interaction) {
  const userId = interaction.user.id;
  const rawCodes = interaction.options.getString('cardcode');
  const rawPrice = interaction.options.getString('price');

  if (!rawCodes) {
    return safeReply(interaction, { content: 'Please provide at least one card code.' });
  }

  let batches, needCounts;
  try {
    ({ batches, needCounts } = parseCodes(rawCodes));
  } catch (err) {
    return safeReply(interaction, { content: err.message });
  }
  if (!batches.length) {
    return safeReply(interaction, { content: 'No valid items found. Use `CODE` or `CODE+2` (quantity uses `+`).' });
  }

  let prices;
  try {
    prices = parsePrices(rawPrice, batches);
  } catch (err) {
    return safeReply(interaction, { content: err.message });
  }

  const existingCount = await MarketListing.countDocuments({ sellerId: userId });
  const remainingSlots = Math.max(0, MAX_LISTINGS - existingCount);
  const totalRequested = Array.from(needCounts.values()).reduce((a, b) => a + b, 0);

  if (remainingSlots <= 0) {
    return safeReply(interaction, { content: `You can only have ${MAX_LISTINGS} listings at a time.` });
  }
  if (totalRequested > remainingSlots) {
    return safeReply(interaction, {
      content: `You only have **${remainingSlots}** listing slot(s) left, but you tried to list **${totalRequested}** item(s).`
    });
  }

  const uniqueCodes = Array.from(needCounts.keys());
  const [invDocs, cards] = await Promise.all([
    InventoryItem.find({ userId, cardCode: { $in: uniqueCodes } })
      .select({ cardCode: 1, quantity: 1, _id: 0 })
      .lean(),
    Card.find({ cardCode: { $in: uniqueCodes } })
      .select({ cardCode: 1, name: 1, group: 1, era: 1, emoji: 1, rarity: 1, category: 1, localImagePath: 1 })
      .lean()
  ]);

  const invMap = new Map(invDocs.map(d => [String(d.cardCode).toUpperCase(), Number(d.quantity) || 0]));

  for (const [code, needed] of needCounts.entries()) {
    const have = invMap.get(code) || 0;
    if (have < needed) {
      return safeReply(interaction, { content: `You do not have **${needed}** of **${code}** (you have ${have}).` });
    }
  }

  if (cards.length !== uniqueCodes.length) {
    const foundSet = new Set(cards.map(c => c.cardCode.toUpperCase()));
    const missing = uniqueCodes.filter(c => !foundSet.has(c));
    return safeReply(interaction, { content: `Metadata not found for: \`${missing.join('`, `')}\`.` });
  }

  const metaByCode = new Map(cards.map(c => [c.cardCode.toUpperCase(), c]));

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const card = metaByCode.get(batch.code);
    const capError = checkPriceCapsForCard(card, prices[i]);
    if (capError) return safeReply(interaction, { content: capError });
  }

  // ---- Create listings (WITH UNIQUE BUY CODES) ----
  const created = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const card = metaByCode.get(batch.code);
    const priceToUse = prices[i];

    const buyCodes = [];
    for (let j = 0; j < batch.qty; j++) {
      const doc = await createListingWithUniqueCode({
        cardCode: card.cardCode,
        cardName: card.name,
        group: card.group,
        era: card.era,
        emoji: card.emoji,
        rarity: card.rarity,
        localImagePath: card.localImagePath,
        price: priceToUse,
        sellerId: userId,
        sellerTag: `${interaction.user.username}#${interaction.user.discriminator}`
      });
      buyCodes.push(doc.buyCode);
    }

    created.push({ code: batch.code, name: card.name, qty: batch.qty, price: priceToUse, buyCodes });
  }

  // ---- Decrement inventory (atomic) ----
  const decOps = [];
  for (const [code, qty] of needCounts.entries()) {
    decOps.push({
      updateOne: {
        filter: { userId, cardCode: code, quantity: { $gte: qty } },
        update: { $inc: { quantity: -qty } }
      }
    });
  }
  if (decOps.length) {
    await InventoryItem.bulkWrite(decOps, { ordered: true });
    await InventoryItem.deleteMany({ userId, cardCode: { $in: uniqueCodes }, quantity: { $lte: 0 } });
  }

  const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const awaitUserButton = require('../../../utils/awaitUserButton'); // ⚠️ make sure this is available!

let current = 0;
const perPage = 5;
const totalPages = Math.ceil(created.length / perPage);

const renderEmbed = () => {
  const pageItems = created.slice(current * perPage, (current + 1) * perPage);
  const desc = pageItems.map(item => {
    const codesList = item.buyCodes.map(b => `\`${b}\``).join(', ');
    return `• **${item.name}** \`${item.code}\` × **${item.qty}** @ **${item.price}** <:ehx_patterns:1389584144895315978> — Buy Codes: ${codesList}`;
  }).join('\n');

  return new EmbedBuilder()
    .setTitle('Listing Summary')
    .setDescription(desc)
    .setColor('#00BFA5')
    .setFooter({ text: `Page ${current + 1} of ${totalPages}` });
};

const renderRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary).setDisabled(current === 0).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
  new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary).setDisabled(current === 0).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
  new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary).setDisabled(current >= totalPages - 1).setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
  new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary).setDisabled(current >= totalPages - 1).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
  new ButtonBuilder().setCustomId('copy').setStyle(ButtonStyle.Success).setLabel('Copy Codes')
);

await safeReply(interaction, { embeds: [renderEmbed()], components: [renderRow()] });

while (true) {
  const btn = await awaitUserButton(interaction, userId, ['first', 'prev', 'next', 'last', 'copy'], 120000);
  if (!btn) break;
  if (!btn.deferred && !btn.replied) await btn.deferUpdate();

  if (btn.customId === 'first') current = 0;
  if (btn.customId === 'prev')  current = Math.max(0, current - 1);
  if (btn.customId === 'next')  current = Math.min(totalPages - 1, current + 1);
  if (btn.customId === 'last')  current = totalPages - 1;
  if (btn.customId === 'copy') {
    const slice = created.slice(current * perPage, (current + 1) * perPage);
    const codes = slice.flatMap(i => i.buyCodes).join(', ');
    await interaction.followUp({ content: codes, flags: 1 << 6 });
    continue;
  }

  await interaction.editReply({ embeds: [renderEmbed()], components: [renderRow()] });
}

try {
  await interaction.editReply({ components: [] });
} catch {}
};
