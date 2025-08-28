// commands/stall/sell.js
const UserInventory = require('../../../models/UserInventory');
const Card = require('../../../models/Card');
const MarketListing = require('../../../models/MarketListing');
const { safeReply } = require('../../../utils/safeReply');
const shortid = require('shortid');

// ---- CONFIG -------------------------------------------------------------

// Rarity-based caps (unchanged)
const RARITY_CAPS = { 1: 300, 2: 600, 3: 900, 4: 1200 };

// Special 5★ rule (unchanged)
const isSpecialR5 = (card) =>
  Number(card.rarity) === 5 &&
  ['kpop', 'anime', 'game', 'franchise'].includes(String(card.category || '').toLowerCase());

// ---- ERA CAPS CONFIG ----------------------------------------------------
// Define them normally (any case/spacing, whatever you like)
const ERA_PRICE_CAPS_RAW = {
  'VIR25': 17000,
  'LEO25': 21000,
  'PC25': 30000,
  'How It\'s Done': 27000
};

// Normalize keys to lowercase+trim once at startup
const ERA_PRICE_CAPS = Object.fromEntries(
  Object.entries(ERA_PRICE_CAPS_RAW).map(([k, v]) => [String(k).trim().toLowerCase(), Number(v)])
);

// Max concurrent listings per seller (unchanged)
const MAX_LISTINGS = 50;

// ---- PARSERS ------------------------------------------------------------

/**
 * Parse codes:
 *   CODE
 *   CODE+QTY
 * Space/comma separated. Quantity uses '+' only. 'x' is rejected.
 * Returns batches: [{ code, qty }] and totals per code: Map<code, qtyNeeded>
 */
function parseCodes(raw) {
  const batches = [];
  const needCounts = new Map();
  if (!raw) return { batches, needCounts };

  const tokens = raw.trim().split(/[\s,]+/).filter(Boolean);

  for (const t of tokens) {
    if (/^[A-Za-z0-9-]+x\d+$/i.test(t)) {
      throw new Error('Quantity must use "+" (e.g. CODE+2), not "x".');
    }
    const m = t.match(/^([A-Za-z0-9-]+)(?:\+(\d+))?$/);
    if (!m) continue;

    const code = m[1].toUpperCase();
    const qty = m[2] ? Math.max(1, parseInt(m[2], 10)) : 1;

    batches.push({ code, qty });
    needCounts.set(code, (needCounts.get(code) || 0) + qty);
  }

  return { batches, needCounts };
}

/**
 * Parse prices from the price STRING option.
 * Accepts:
 *   - single integer: "900" (applied to all batches)
 *   - list of integers: "700, 800 900" (order matches batches)
 * Returns an array of numbers of length == batches.length, or throws with a helpful message.
 */
function parsePrices(rawPrice, batches) {
  if (!rawPrice || typeof rawPrice !== 'string') {
    throw new Error('You must provide a price. Use a single number or a list matching each card.');
  }

  const priceTokens = rawPrice.trim().split(/[\s,]+/).filter(Boolean);

  // Single price for all
  if (priceTokens.length === 1) {
    const p = parseInt(priceTokens[0], 10);
    if (!Number.isFinite(p) || p <= 0) {
      throw new Error('Price must be a positive number.');
    }
    return Array(batches.length).fill(p);
  }
  // Many prices: must match batches length
  if (priceTokens.length !== batches.length) {
    // figure out which code is missing a price (first unmatched index)
    const idx = Math.min(priceTokens.length, batches.length) - 1;
    const missingIdx = priceTokens.length < batches.length ? priceTokens.length : -1;
    if (missingIdx >= 0) {
      const missingCode = batches[missingIdx]?.code || 'UNKNOWN';
      throw new Error(`No price provided for **${missingCode}**. Please supply the same number of prices as card entries.`);
    } else {
      throw new Error(`You provided more prices than cards. Please match counts exactly (${batches.length}).`);
    }
  }

  const prices = priceTokens.map((t, i) => {
    const p = parseInt(t, 10);
    if (!Number.isFinite(p) || p <= 0) {
      throw new Error(`Invalid price "${t}" for **${batches[i].code}**. Prices must be positive integers.`);
    }
    return p;
  });

  return prices;
}

// ---- CAPS ---------------------------------------------------------------

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

// ---- HANDLER ------------------------------------------------------------

module.exports = async function sell(interaction) {
  const userId = interaction.user.id;
  const rawCodes = interaction.options.getString('cardcode'); // e.g., "ABC123 DEF456+2 GHI789"
  const rawPrice = interaction.options.getString('price');     // e.g., "900" or "700 800 900"

  if (!rawCodes) {
    return safeReply(interaction, { content: 'Please provide at least one card code.' });
  }

  // Parse codes/quantities
  let batches, needCounts;
  try {
    ({ batches, needCounts } = parseCodes(rawCodes));
  } catch (err) {
    return safeReply(interaction, { content: err.message });
  }
  if (!batches.length) {
    return safeReply(interaction, { content: 'No valid items found. Use `CODE` or `CODE+2` (quantity uses `+`).' });
  }

  // Parse prices (must match batches count or be a single price)
  let prices;
  try {
    prices = parsePrices(rawPrice, batches); // array length == batches.length
  } catch (err) {
    return safeReply(interaction, { content: err.message });
  }
  // Listing slots check
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

  // Load inventory
  const inventoryDoc = await UserInventory.findOne({ userId });
  if (!inventoryDoc) {
    return safeReply(interaction, { content: 'You have no inventory record.' });
  }

  // Ownership check
  const invMap = new Map(
    inventoryDoc.cards.map(c => [String(c.cardCode).trim().toUpperCase(), Number(c.quantity) || 0])
  );
  for (const [code, needed] of needCounts.entries()) {
    const have = invMap.get(code) || 0;
    if (have < needed) {
      return safeReply(interaction, { content: `You do not have **${needed}** of **${code}** (you have ${have}).` });
    }
  }

  // Card metadata
  const uniqueCodes = Array.from(needCounts.keys());
  const cards = await Card.find({ cardCode: { $in: uniqueCodes } });
  if (cards.length !== uniqueCodes.length) {
    const foundSet = new Set(cards.map(c => c.cardCode));
    const missing = uniqueCodes.filter(c => !foundSet.has(c));
    return safeReply(interaction, {
      content: `Metadata not found for: \`${missing.join('`, `')}\`.`
    });
  }
  const metaByCode = new Map(cards.map(c => [c.cardCode.toUpperCase(), c]));

  // Validate caps per batch/price
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const card = metaByCode.get(batch.code);
    const capError = checkPriceCapsForCard(card, prices[i]);
    if (capError) return safeReply(interaction, { content: capError });
  }

  // Create listings and decrement inventory
  const created = []; // [{ code, name, qty, price, buyCodes[] }]
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const card = metaByCode.get(batch.code);
    const priceToUse = prices[i];

    const buyCodes = [];
    for (let j = 0; j < batch.qty; j++) {
      const buyCode = shortid.generate().toUpperCase();
      buyCodes.push(buyCode);

      await MarketListing.create({
        cardCode: card.cardCode,
        cardName: card.name,
        group: card.group,
        era: card.era,
        emoji: card.emoji,
        rarity: card.rarity,
        localImagePath: card.localImagePath,
        price: priceToUse,
        sellerId: userId,
        sellerTag: `${interaction.user.username}#${interaction.user.discriminator}`,
        buyCode
      });
    }

    // decrement inventory for this code
    invMap.set(batch.code, (invMap.get(batch.code) || 0) - batch.qty);

    created.push({ code: batch.code, name: card.name, qty: batch.qty, price: priceToUse, buyCodes });
  }

  // Persist inventory
  inventoryDoc.cards = Array.from(invMap.entries())
    .filter(([, q]) => q > 0)
    .map(([cardCode, quantity]) => ({ cardCode, quantity }));
  await inventoryDoc.save();

  // Build reply
  const totalListed = created.reduce((a, c) => a + c.qty, 0);
  const summaryLines = created.map(item => {
    const codesList = item.buyCodes.map(b => `\`${b}\``).join(', ');
    return `• **${item.name}** \`${item.code}\` × **${item.qty}** @ **${item.price}** <:ehx_patterns:1389584144895315978> — Buy Codes: ${codesList}`;
  });

  await safeReply(interaction, {
    content: [
      `<@${userId}> listed **${totalListed}** card(s):`,
      ...summaryLines
    ].join('\n')
  });
};