// commands/global/subcommands/stallpreview.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const MarketListing = require('../../../models/MarketListing');
const InventoryItem = require('../../../models/InventoryItem');
const generateStars = require('../../../utils/starGenerator');
const { stallPreviewFilters } = require('../../../utils/cache');
const { safeReply } = require('../../../utils/safeReply');

// ===== Config =====
const DEFAULT_PER_PAGE = 6;
const MAX_PER_PAGE = 6;
const MAX_DEFAULT_PAGES = 200; // cap pages when no filters to avoid scanning forever

// ===== Utilities =====
const clampPerPage = (n) => {
  if (!Number.isFinite(n)) return undefined;
  return Math.min(Math.max(1, n), MAX_PER_PAGE);
};

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCSVList(str) {
  if (!str) return [];
  return String(str)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Parse rarity spec like:
 *  "1" | "1,3" | "1-4" | "1,3-5"
 * Returns an array of ints (unique, sorted).
 */
function parseRaritySpec(spec) {
  if (!spec) return [];
  const out = new Set();
  const tokens = String(spec).split(',').map(t => t.trim()).filter(Boolean);

  for (const t of tokens) {
    const range = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      let a = parseInt(range[1], 10);
      let b = parseInt(range[2], 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      if (a > b) [a, b] = [b, a];
      for (let x = a; x <= b; x++) out.add(x);
      continue;
    }
    const n = parseInt(t, 10);
    if (Number.isFinite(n)) out.add(n);
  }

  // only allow sensible rarities (adjust if your game uses different bounds)
  const arr = [...out].filter(n => n >= 1 && n <= 10).sort((a, b) => a - b);
  return arr;
}

// =========== Main exported handler ===========
// This function supports both slash invocation and button pagination via router.
module.exports = async function stallPreview(interaction, incomingOptions = {}) {
  const isButton = interaction.isButton?.();
  let options;

  if (isButton) {
    // Router should pass back the same options we cached earlier
    options = incomingOptions;
  } else {
    // Slash options — we accept BOTH old integer rarity and new flexible string rarity(s)
    // If your slash builder doesn’t have 'rarities' yet, add it (see note below).
    const sellerUser = interaction.options.getUser?.('seller');

    // New: comma-separated lists for names/groups/eras
    const namesOpt  = interaction.options.getString?.('name');
    const groupsOpt = interaction.options.getString?.('group');
    const erasOpt   = interaction.options.getString?.('era');

    // Rarity can come from:
    //  - integer 'rarity' (legacy)
    //  - string  'rarities' (new: "1", "1,3", "1-4", etc.)
    const rarityInt  = interaction.options.getInteger?.('rarity');      // legacy
    const raritiesStr= interaction.options.getString?.('rarities');     // new flexible

    options = {
      // Multi filters (arrays)
      names:  parseCSVList(namesOpt),
      groups: parseCSVList(groupsOpt),
      eras:   parseCSVList(erasOpt),

      // Legacy + new
      rarity: rarityInt,                         // single rarity (legacy)
      rarities: parseRaritySpec(raritiesStr),    // multi/range

      seller: sellerUser,
      cheapest: interaction.options.getBoolean?.('cheapest'),
      newest:   interaction.options.getBoolean?.('newest'),
      unowned:  interaction.options.getBoolean?.('unowned'),
      page:     interaction.options.getInteger?.('page') || 1,
      perPage:  clampPerPage(interaction.options.getInteger?.('per_page')) || DEFAULT_PER_PAGE,
      compact:  interaction.options.getBoolean?.('compact') ?? false,
      delivery: incomingOptions.delivery // optional router hint
    };
  }

  return renderPreview(interaction, options);
};

// =========== Renderer ===========
async function renderPreview(interaction, options) {
  const {
    names = [], groups = [], eras = [],
    rarity, rarities = [],
    seller, cheapest, newest, unowned,
    page, perPage, compact, delivery
  } = options;

  // ----- Build Mongo filter -----
  const filter = {};

  // Names/groups/eras -> arrays of case-insensitive exact match regexes (anchor ^$)
  if (names.length) {
    filter.cardName = { $in: names.map(n => new RegExp(`^${escapeRegex(n)}$`, 'i')) };
  }
  if (groups.length) {
    filter.group = { $in: groups.map(g => new RegExp(`^${escapeRegex(g)}$`, 'i')) };
  }
  if (eras.length) {
    filter.era = { $in: eras.map(e => new RegExp(`^${escapeRegex(e)}$`, 'i')) };
  }

  // Rarity handling:
  // - If rarities[] present (from string spec), use that
  // - else if legacy single rarity provided, use it
  if (rarities.length) {
    filter.rarity = { $in: rarities };
  } else if (Number.isInteger(rarity)) {
    filter.rarity = rarity;
  }

  if (seller) filter.sellerId = seller.id;

  // Unowned via InventoryItem (per-item model)
  if (unowned) {
    const inv = await InventoryItem.find({ userId: interaction.user.id })
      .select({ cardCode: 1, _id: 0 })
      .lean();
    const ownedCodes = inv.map(x => x.cardCode);
    filter.cardCode = { $nin: ownedCodes };
  }

  // Sort
  const sort = cheapest ? { price: 1 }
    : newest ? { createdAt: -1 }
    : { createdAt: 1 };

  // Pagination
  const skip = (page - 1) * perPage;

  // Query page
  const listings = await MarketListing.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(perPage)
    .lean();

  if (!listings.length) {
    const payload = { content: 'No listings found for that page or filter.', components: [] };
    if (interaction.isButton?.() || delivery === 'update') {
      try { await interaction.editReply(payload); } catch {}
    } else {
      await safeReply(interaction, payload);
    }
    return;
  }

  // Count for total pages (cap when no filters)
  const count = await MarketListing.countDocuments(filter);
  const totalPages = (Object.keys(filter).length === 0)
    ? Math.min(Math.ceil(count / perPage), MAX_DEFAULT_PAGES)
    : Math.ceil(count / perPage);

  // ----- Build embed -----
  const embed = new EmbedBuilder()
    .setTitle(`Stall Preview — Page ${page}/${totalPages}`)
    .setColor('#ffc800')
    .setFooter({ text: 'Use /stall buy [buycode] to purchase cards' });

  let files = [];

  if (compact) {
    // Compact list (no images), multiple items per page
    const lines = listings.map(l => {
      const stars = generateStars({ rarity: l.rarity, overrideEmoji: l.emoji });
      return `**${stars} ${l.cardName}** \`${l.cardCode}\`\n**${l.price} <:ehx_patterns:1389584144895315978>** — <@${l.sellerId}>\n**Buy Code:** \`${l.buyCode}\`\n`;
    });
    embed.setDescription(lines.join('\n'));
  } else {
    // Visual mode: single embed with fields (first image if available)
    const first = listings[0];
    const firstImageUrl = first.localImagePath
      ? `attachment://${first._id}.png`
      : (first.discordPermalinkImage || first.imgurImageLink || first.imageUrl);

    if (first.localImagePath) {
      files = [{ attachment: first.localImagePath, name: `${first._id}.png` }];
    }
    if (firstImageUrl) embed.setImage(firstImageUrl);

    for (const l of listings) {
      const stars = generateStars({ rarity: l.rarity, overrideEmoji: l.emoji });
      embed.addFields({
        name: `${stars} ${l.cardName} — \`${l.cardCode}\``,
        value:
          `**Price**: <:ehx_patterns:1389584144895315978> ${l.price}\n` +
          `**Buy Code**: \`${l.buyCode}\`\n` +
          `**Seller**: <@${l.sellerId}>`
      });
    }
  }

  // Nav buttons (IDs unchanged)
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('stall_first').setStyle(ButtonStyle.Secondary).setDisabled(page === 1).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
    new ButtonBuilder().setCustomId('stall_prev').setStyle(ButtonStyle.Primary).setDisabled(page === 1).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
    new ButtonBuilder().setCustomId('stall_next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages).setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
    new ButtonBuilder().setCustomId('stall_last').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
    new ButtonBuilder().setCustomId('stall_copy').setLabel('Copy Buy Codes').setStyle(ButtonStyle.Success)
  );

  const payload = { embeds: [embed], components: [row], files };

  if (interaction.isButton?.() || delivery === 'update') {
    try { await interaction.editReply(payload); } catch {}
  } else {
    await safeReply(interaction, payload);
  }

  // Cache filters for your router pagination
  let replyMessage = null;
  try { replyMessage = await interaction.fetchReply(); } catch {}
  if (replyMessage?.id) {
    stallPreviewFilters.set(replyMessage.id, {
      // cache the arrays + settings so button clicks can reuse them
      names, groups, eras,
      rarity, rarities,
      seller, cheapest, newest, unowned,
      page, perPage, compact
    });

    // Auto-disable after 10 minutes
    setTimeout(async () => {
      stallPreviewFilters.delete(replyMessage.id);
      try {
        const disabledRow = new ActionRowBuilder().addComponents(
          row.components.map(btn => ButtonBuilder.from(btn).setDisabled(true))
        );
        await replyMessage.edit({ components: [disabledRow] });
      } catch (err) {
        console.warn('❌ Failed to disable buttons after timeout:', err?.message || err);
      }
    }, 10 * 60 * 1000);
  }
}
