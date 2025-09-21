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
    .addStringOption(opt => opt.setName('category').setDescription('Filter by category (kpop, anime, game, etc.)'))
    .addStringOption(opt => opt.setName('group').setDescription('Filter by group(s)'))
    .addStringOption(opt => opt.setName('era').setDescription('Filter by era(s)'))
    .addStringOption(opt => opt.setName('name').setDescription('Filter by name(s)'))
    .addStringOption(opt => opt.setName('rarity').setDescription('Filter by rarity: 3 | 2-5 | 2,4,5'))
    .addStringOption(opt =>
      opt.setName('include_others').setDescription('Show Customs, Test & Limited cards?')
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

    // Build Mongo query for cards
    const cardQuery = {};
    if (groups.length) {
  cardQuery.group = { $in: groups.map(g => new RegExp(`^${g}$`, 'i')) };
}
if (eras.length) {
  cardQuery.era = { $in: eras.map(e => new RegExp(`^${e}$`, 'i')) };
}
if (names.length) {
  cardQuery.name = { $in: names.map(n => new RegExp(`^${n}$`, 'i')) };
}
if (categories.length) {
  cardQuery.category = { $in: categories.map(c => new RegExp(`^${c}$`, 'i')) };
}
    if (allowedRarities)   cardQuery.rarity = { $in: allowedRarities };
    else                   cardQuery.rarity = { $gte: minR, $lte: maxR };
    if (!includeOthers)    cardQuery.era = { $nin: ['customs', 'test', 'limited'] };

    // Fetch cards + inventory in parallel
    const [cards, invDocs] = await Promise.all([
      Card.find(cardQuery).lean(),
      InventoryItem.find({ userId: user.id }).lean()
    ]);
    const inventoryMap = new Map(invDocs.map(d => [d.cardCode, d.quantity]));

    // Build entries
    const entries = cards
      .map(c => {
        const qty = inventoryMap.get(c.cardCode) || 0;
        return {
          name: c.name,
          group: c.group,
          category: c.category || '',
          era: c.era || '',
          cardCode: c.cardCode,
          rarity: c.rarity,
          copies: qty,
          stars: generateStars({ rarity: c.rarity, overrideEmoji: c.emoji })
        };
      })
      .filter(e => {
        if (show === 'owned') return e.copies > 0;
        if (show === 'missing') return e.copies === 0;
        if (show === 'dupes') return e.copies > 1;
        return true;
      })
      .sort((a, b) => b.rarity - a.rarity);

    if (!entries.length) {
      return interaction.editReply({ content: 'No cards match your filters.' });
    }

    // Totals
    let totalCopies = 0, totalStars = 0;
    for (const e of entries) {
      const count = show === 'dupes' ? Math.max(0, e.copies - 1) : e.copies;
      totalCopies += count;
      totalStars  += e.rarity * count;
    }

    // Pagination (first page only here; your button handler can reuse `entries`)
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

    // cache entries for button pagination
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