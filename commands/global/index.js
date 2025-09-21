// commands/index.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const Card = require('../../models/Card');
const UserInventory = require('../../models/UserInventory');
const generateStars = require('../../utils/starGenerator');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('index')
    .setDescription('View your inventory with filters and pagination.')
    .addStringOption(opt =>
      opt
        .setName('show')
        .setDescription('Which cards to show')
        .setRequired(true)
        .addChoices(
          { name: 'Owned Only', value: 'owned' },
          { name: 'Missing Only', value: 'missing' },
          { name: 'Duplicates Only', value: 'dupes' },
          { name: 'All', value: 'all' }
        )
    )
    .addUserOption(opt => opt.setName('user').setDescription('Whose inventory to view?'))
    .addStringOption(opt => opt.setName('group').setDescription('Filter by group (comma to OR)'))
    .addStringOption(opt => opt.setName('era').setDescription('Filter by era (comma to OR)'))
    .addStringOption(opt => opt.setName('name').setDescription('Filter by card name (comma to OR)'))
    // Updated help text: allow 3, 2-5, or 2,4,5
    .addStringOption(opt =>
      opt.setName('rarity').setDescription('Rarity filter: `3`, `2-5`, or `2,4,5`')
    )
    .addStringOption(opt =>
      opt
        .setName('include_others')
        .setDescription('Show Customs, Test & Limited cards?')
        .addChoices({ name: 'Yes', value: 'yes' }, { name: 'No', value: 'no' })
    ),

  async execute(interaction) {
    // simple in-memory session storage for pagination
    interaction.client.cache = interaction.client.cache || {};
    interaction.client.cache.indexSessions = interaction.client.cache.indexSessions || {};

    const user = interaction.options.getUser('user') || interaction.user;
    const parseList = (s) =>
      s?.split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => t.toLowerCase()) || [];

    // --- RARITY PARSING: single, range, or comma-list ---
    const rarityRaw = interaction.options.getString('rarity');
    let allowedRarities = null; // array of exact rarities when user passes a list
    let minRarity = 1;
    let maxRarity = 5;

    if (rarityRaw) {
      const rangeMatch = rarityRaw.match(/^(\d+)-(\d+)$/);
      const singleMatch = rarityRaw.match(/^(\d+)$/);
      const listMatch = rarityRaw.match(/^(\d+(?:,\d+)*)$/);

      if (rangeMatch) {
        minRarity = clamp(parseInt(rangeMatch[1], 10), 1, 5);
        maxRarity = clamp(parseInt(rangeMatch[2], 10), 1, 5);
        if (minRarity > maxRarity) [minRarity, maxRarity] = [maxRarity, minRarity];
      } else if (singleMatch) {
        const v = clamp(parseInt(singleMatch[1], 10), 1, 5);
        minRarity = v;
        maxRarity = v;
      } else if (listMatch) {
        allowedRarities = listMatch[1]
          .split(',')
          .map((n) => clamp(parseInt(n, 10), 1, 5))
          .filter((n, i, a) => !Number.isNaN(n) && a.indexOf(n) === i) // unique + valid
          .sort((a, b) => a - b);
        if (!allowedRarities.length) {
          return safeReply(interaction, {
            content: 'Invalid rarity list. Use something like `2,4,5`.'
          });
        }
      } else {
        return safeReply(interaction, {
          content: 'Invalid rarity format. Use `3`, `2-5`, or `2,4,5`.'
        });
      }
    }
    // ----------------------------------------------------
    const filters = {
      groups: parseList(interaction.options.getString('group')),
      eras: parseList(interaction.options.getString('era')),
      names: parseList(interaction.options.getString('name')),
      show: interaction.options.getString('show') || 'owned',
      includeCustoms: interaction.options.getString('include_others') === 'yes',
      minRarity,
      maxRarity,
      allowedRarities
    };

    // Fetch data
    const [allCards, inv] = await Promise.all([
      Card.find().lean(),
      UserInventory.findOne({ userId: user.id }).lean()
    ]);
    const inventoryMap = new Map((inv?.cards || []).map((c) => [c.cardCode, c.quantity]));

   // Filter
    const filtered = allCards
      .filter((card) => {
        const qty = inventoryMap.get(card.cardCode) || 0;
        const inInv = qty > 0;

        // allow OR semantics for multi-values
        const groupMatch =
          !filters.groups.length || filters.groups.includes((card.group || '').toLowerCase());
        const eraMatch =
          !filters.eras.length || filters.eras.includes((card.era || '').toLowerCase());
        const nameMatch =
          !filters.names.length || filters.names.includes((card.name || '').toLowerCase());

        // rarity: if list provided -> exact match; else use min/max inclusive
        const rarityMatch = filters.allowedRarities
          ? filters.allowedRarities.includes(Number(card.rarity))
          : Number(card.rarity) >= filters.minRarity && Number(card.rarity) <= filters.maxRarity;
          // exclude customs/test/limited when requested
        if (
          !filters.includeCustoms &&
          ['customs', 'test', 'limited'].includes((card.era || '').toLowerCase())
        ) {
          return false;
        }

       if (!(groupMatch && eraMatch && nameMatch && rarityMatch)) return false;

        if (filters.show === 'owned') return inInv;
        if (filters.show === 'missing') return !inInv;
        if (filters.show === 'dupes') return qty > 1;
        return true; // 'all'
      })
      .sort((a, b) => Number(b.rarity) - Number(a.rarity));

    if (!filtered.length) {
      return safeReply(interaction, { content: 'No cards match your filters.' });
    }

    // Build entries for current page rendering & later pagination
    const entries = filtered.map((c) => {
      const qty = inventoryMap.get(c.cardCode) || 0;
      return {
        name: c.name,
        group: c.group,
        category: (c.category || '').toLowerCase(),
        era: c.era || '',
        cardCode: c.cardCode,
        rarity: Number(c.rarity),
        copies: qty,
        stars: generateStars({ rarity: Number(c.rarity), overrideEmoji: c.emoji })
      };
    });

    // Totals
    let totalCopies = 0;
    let totalStars = 0;
    if (filters.show === 'dupes') {
      for (const e of entries) {
        if (e.copies > 1) {
          totalCopies += e.copies - 1;
          totalStars += e.rarity * (e.copies - 1);
        }
      }
    } else {
      for (const e of entries) {
        totalCopies += e.copies;
        totalStars += e.rarity * e.copies;
      }
    }
    // Pagination
    const perPage = 6;
    const totalPages = Math.ceil(entries.length / perPage);
    const page = 0;

    const pageSlice = entries.slice(page * perPage, page * perPage + perPage);
    const description = pageSlice
      .map((card) => {
        const eraPart = card.category === 'kpop' && card.era ? ` | Era: ${card.era}` : '';
        return `**${card.stars} ${card.name}**\nGroup: ${card.group}${eraPart} | Code: \`${card.cardCode}\` | Copies: ${card.copies}`;
      })
      .join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s Inventory`)
      .setDescription(description)
      .setColor('#FF69B4')
      .setFooter({
        text: `Page ${page + 1} of ${totalPages} • Total Cards: ${entries.length} • Total Copies: ${totalCopies} • Total Stars: ${totalStars}`
      });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('index:first')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0)
        .setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new ButtonBuilder()
        .setCustomId('index:prev')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 0)
        .setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new ButtonBuilder()
        .setCustomId('index:next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page >= totalPages - 1)
        .setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
      new ButtonBuilder()
        .setCustomId('index:last')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
        .setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
      new ButtonBuilder()
        .setCustomId('index:copy')
        .setLabel('Copy Codes')
        .setStyle(ButtonStyle.Success)
    );
    // Send & store session for button handlers
    await safeReply(interaction, { embeds: [embed], components: [row] });
    const sent = await interaction.fetchReply();

    interaction.client.cache.indexSessions[sent.id] = {
      entries,
      perPage,
      totalPages,
      totalCards: entries.length,
      totalCopies,
      totalStars
    };
  }
};

// --- helpers ---
function clamp(v, min, max) {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}