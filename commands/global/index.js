// commands/global/index.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const Card = require('../../models/Card');
const InventoryItem = require('../../models/InventoryItem');
const generateStars = require('../../utils/starGenerator');
const { safeReply } = require('../../utils/safeReply');
// commands/global/index.js — add this with the other imports at the top
const IndexPrivacy = require('../../models/IndexPrivacy');


function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const toRegexList = (arr) => arr.map(v => new RegExp(`^${escapeRegExp(v)}$`, 'i'));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('index')
    .setDescription('View your inventory with filters and pagination.')
    .addStringOption(opt =>
      opt.setName('show').setDescription('Which cards to show').setRequired(true).addChoices(
        { name: 'Owned Only', value: 'owned' },
        { name: 'Missing Only', value: 'missing' },
        { name: 'Duplicates Only', value: 'dupes' },
        { name: 'All', value: 'all' }
      )
    )
    .addUserOption(opt => opt.setName('user').setDescription('Whose inventory to view?'))
    .addStringOption(opt => opt.setName('category').setDescription('Filter by category (comma=OR)'))
    .addStringOption(opt => opt.setName('group').setDescription('Filter by group (comma=OR)'))
    .addStringOption(opt => opt.setName('era').setDescription('Filter by era (comma=OR)'))
    .addStringOption(opt => opt.setName('name').setDescription('Filter by name (comma=OR)'))
    .addStringOption(opt => opt.setName('rarity').setDescription('Rarity: 3 | 2-5 | 2,4,5'))
    .addStringOption(opt =>
      opt.setName('include_others')
        .setDescription('Show Customs, Test & Limited cards?')
        .addChoices({ name: 'Yes', value: 'yes' }, { name: 'No', value: 'no' })
    ),

  async execute(interaction) {

    const user = interaction.options.getUser('user') || interaction.user;
    const show = interaction.options.getString('show');
    const includeOthers = interaction.options.getString('include_others') === 'yes';

    const parseList = (s) => (s || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);

    // Parse filters
    const categories = parseList(interaction.options.getString('category'));
    const groups     = parseList(interaction.options.getString('group'));
    const eras       = parseList(interaction.options.getString('era'));
    const names      = parseList(interaction.options.getString('name'));

    // Rarity parsing
    const rarityRaw = interaction.options.getString('rarity');
    let allowedRarities = null, minR = 1, maxR = 5;
    const clamp = (v) => Math.max(1, Math.min(5, v));
    if (rarityRaw) {
      const range = rarityRaw.match(/^(\d+)-(\d+)$/);
      const single = rarityRaw.match(/^(\d+)$/);
      const list = rarityRaw.match(/^(\d+(?:,\d+)*)$/);
      if (range) {
        minR = clamp(+range[1]); maxR = clamp(+range[2]);
        if (minR > maxR) [minR, maxR] = [maxR, minR];
      } else if (single) {
        minR = maxR = clamp(+single[1]);
      } else if (list) {
        allowedRarities = list[1].split(',').map(Number).filter(n => n >= 1 && n <= 5);
      }
    }

    // ---- Card query ----
    const and = [];
    if (categories.length) and.push({ category: { $in: toRegexList(categories) } });
    if (groups.length)     and.push({ group:    { $in: toRegexList(groups) } });
    if (eras.length)       and.push({ era:      { $in: toRegexList(eras) } });
    if (names.length)      and.push({ name:     { $in: toRegexList(names) } });

    if (allowedRarities) and.push({ rarity: { $in: allowedRarities } });
    else                 and.push({ rarity: { $gte: minR, $lte: maxR } });

    if (!includeOthers) {
      // exclude Customs/Test/Limited (case-insensitive)
      and.push({ era: { $not: /^(customs|test|limited)$/i } });
    }

    // ---- PRIVACY ENFORCEMENT (hide other users’ private content) ----
const isSelfView = user.id === interaction.user.id;
if (!isSelfView) {
  const priv = await IndexPrivacy.findOne({ userId: user.id }).lean();
  if (priv?.hideAll) {
    return interaction.editReply({ content: 'This user has set their index to private.' });
  }
  if (priv) {
    const pushNin = (field, list) => {
      if (!Array.isArray(list) || list.length === 0) return;
      and.push({ [field]: { $nin: toRegexList(list) } });
    };

    // Adjust these field names if your Card schema uses different ones
    pushNin('cardCode', priv.cards);
    pushNin('group',    priv.groups);
    pushNin('name',     priv.names);
    pushNin('era',      priv.eras);
  }
}
// ---- end privacy enforcement ----

    const cardQuery = and.length ? { $and: and } : {};

    // fetch cards + inventory
    const [cards, invDocs] = await Promise.all([
      Card.find(cardQuery).sort({ _id: 1 }).lean(), // oldest first
      InventoryItem.find({ userId: user.id }).lean()
    ]);

    const invMap = new Map(invDocs.map(d => [d.cardCode, d.quantity]));

    // build entries
    const entries = cards
      .map((c, idx) => {
        const qty = invMap.get(c.cardCode) || 0;
        return {
          name: c.name,
          group: c.group,
          category: (c.category || '').toLowerCase(),
          era: c.era || '',
          cardCode: c.cardCode,
          rarity: Number(c.rarity),
          copies: qty,
          stars: generateStars({ rarity: Number(c.rarity), overrideEmoji: c.emoji }),
          originalIndex: idx // 🧩 store the “oldest first” order
        };
      })
      .filter(e => {
        if (show === 'owned')   return e.copies > 0;
        if (show === 'missing') return e.copies === 0;
        if (show === 'dupes')   return e.copies > 1;
        return true;
      })
      .sort((a, b) => {
    // 1️⃣ rarity descending
    if (b.rarity !== a.rarity) return b.rarity - a.rarity;

    // 2️⃣ group alphabetical
    const groupCompare = a.group.localeCompare(b.group, undefined, { sensitivity: 'base' });
    if (groupCompare !== 0) return groupCompare;

    // 3️⃣ name alphabetical
    const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (nameCompare !== 0) return nameCompare;

    // 4️⃣ finally, preserve original DB order
    return a.originalIndex - b.originalIndex;
      });

    if (!entries.length) {
      return interaction.editReply({ content: 'No cards match your filters.' });
    }

    // totals
    let totalCopies = 0, totalStars = 0;
    for (const e of entries) {
      const count = show === 'dupes' ? Math.max(0, e.copies - 1) : e.copies;
      totalCopies += count;
      totalStars  += e.rarity * count;
    }

    // page 1
    const perPage = 6;
    const totalPages = Math.max(1, Math.ceil(entries.length / perPage));
    const pageEntries = entries.slice(0, perPage);

    const showEraFor = new Set(['kpop', 'zodiac', 'event']);
    const description = pageEntries.map(card => {
      const eraPart = showEraFor.has(card.category) && card.era ? ` | Era: ${card.era}` : '';
      return `**${card.stars} ${card.name}**\nGroup: ${card.group}${eraPart} | Code: \`${card.cardCode}\` | Copies: ${card.copies}`;
    }).join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s Inventory`)
      .setDescription(description)
      .setColor('#FF69B4')
      .setFooter({ text: `Page 1 of ${totalPages} • Total Cards: ${entries.length} • Total Copies: ${totalCopies} • Total Stars: ${totalStars}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('index:first').setStyle(ButtonStyle.Secondary).setDisabled(true).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new ButtonBuilder().setCustomId('index:prev').setStyle(ButtonStyle.Primary).setDisabled(true).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new ButtonBuilder().setCustomId('index:next').setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1).setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
      new ButtonBuilder().setCustomId('index:last').setStyle(ButtonStyle.Secondary).setDisabled(totalPages <= 1).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
      new ButtonBuilder().setCustomId('index:copy').setLabel('Copy Codes').setStyle(ButtonStyle.Success)
    );

    await safeReply(interaction, { embeds: [embed], components: [row] });

    // cache for pagination buttons
    interaction.client.cache = interaction.client.cache || {};
    interaction.client.cache.indexSessions = interaction.client.cache.indexSessions || {};
    interaction.client.cache.indexSessions[(await interaction.fetchReply()).id] = {
      entries,
      perPage,
      totalPages,
      totalCards: entries.length,
      totalCopies,
      totalStars
    };
  }
};
