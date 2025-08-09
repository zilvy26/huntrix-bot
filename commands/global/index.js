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
const safeReply = require('../../utils/safeReply');

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
    .addStringOption(opt => opt.setName('group').setDescription('Filter by group'))
    .addStringOption(opt => opt.setName('era').setDescription('Filter by era'))
    .addStringOption(opt => opt.setName('name').setDescription('Filter by card name'))
    .addStringOption(opt => opt.setName('rarity').setDescription('Filter by rarity'))
    .addStringOption(opt =>
      opt.setName('include_others')
        .setDescription('Show Customs, Test & Limited cards?')
        .addChoices({ name: 'Yes', value: 'yes' }, { name: 'No', value: 'no' })
    ),

  async execute(interaction) {
    await interaction.deferReply();

    // init cache bucket
    interaction.client.cache = interaction.client.cache || {};
    interaction.client.cache.indexSessions = interaction.client.cache.indexSessions || {};

    const user = interaction.options.getUser('user') || interaction.user;
    const parseList = (s) => s?.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) || [];

    const filters = {
      groups: parseList(interaction.options.getString('group')),
      eras: parseList(interaction.options.getString('era')),
      names: parseList(interaction.options.getString('name')),
      rarities: parseList(interaction.options.getString('rarity')),
      show: interaction.options.getString('show') || 'owned',
      includeCustoms: interaction.options.getString('include_others') === 'yes'
    };

    const allCards = await Card.find().lean();
    const inv = await UserInventory.findOne({ userId: user.id });
    const inventoryMap = new Map(inv?.cards.map(c => [c.cardCode, c.quantity]) || []);
    const cardList = allCards.filter(card => {
      const inInv = inventoryMap.has(card.cardCode);
      const copies = inventoryMap.get(card.cardCode) || 0;

      const groupMatch  = !filters.groups.length   || filters.groups.includes(card.group.toLowerCase());
      const eraMatch    = !filters.eras.length     || filters.eras.includes((card.era || '').toLowerCase());
      const nameMatch   = !filters.names.length    || filters.names.includes(card.name.toLowerCase());
      const rarityMatch = !filters.rarities.length || filters.rarities.includes(String(card.rarity));

      if (!filters.includeCustoms && ['customs','test','limited'].includes(card.era?.toLowerCase())) return false;
      if (!(groupMatch && eraMatch && nameMatch && rarityMatch)) return false;

      if (filters.show === 'owned')  return inInv && copies > 0;
      if (filters.show === 'missing')return !inInv;
      if (filters.show === 'dupes')  return inInv && copies > 1;
      return true;
    }).sort((a, b) => parseInt(b.rarity) - parseInt(a.rarity));

    if (!cardList.length) {
      return safeReply(interaction, { content: 'No cards match your filters.' });
    }

    // totals
    let totalCopies = 0, totalStars = 0;
    if (filters.show === 'dupes') {
      for (const card of cardList) {
        const qty = inventoryMap.get(card.cardCode) || 0;
        if (qty > 1) {
          totalCopies += qty - 1;
          totalStars  += card.rarity * (qty - 1);
        }
      }
    } else {
      totalCopies = cardList.reduce((a,c) => a + (inventoryMap.get(c.cardCode) || 0), 0);
      totalStars  = cardList.reduce((a,c) => a + c.rarity * (inventoryMap.get(c.cardCode) || 0), 0);
    }

    // build entries we need later (so router doesn’t touch DB again)
    const entries = cardList.map(c => ({
      name: c.name,
      group: c.group,
      category: (c.category || '').toLowerCase(),
      era: c.era || '',
      cardCode: c.cardCode,
      rarity: c.rarity,
      copies: inventoryMap.get(c.cardCode) || 0,
      stars: generateStars({ rarity: c.rarity, overrideEmoji: c.emoji })
    }));

    const perPage = 6;
    const totalPages = Math.ceil(entries.length / perPage);
    const page = 0;

    const pageSlice = entries.slice(0, perPage);
    const description = pageSlice.map(card => {
      const eraPart = card.category === 'kpop' && card.era ? ` | Era: ${card.era}` : '';
      return `**${card.stars} ${card.name}**\nGroup: ${card.group}${eraPart} | Code: \`${card.cardCode}\` | Copies: ${card.copies}`;
    }).join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s Inventory`)
      .setDescription(description)
      .setColor('#FF69B4')
      .setFooter({
        text: `Page ${page + 1} of ${totalPages} • Total Cards: ${entries.length} • Total Copies: ${totalCopies} • Total Stars: ${totalStars}`
      });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('index:first').setStyle(ButtonStyle.Secondary).setDisabled(page === 0).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new ButtonBuilder().setCustomId('index:prev').setStyle(ButtonStyle.Primary).setDisabled(page === 0).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new ButtonBuilder().setCustomId('index:next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1).setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
      new ButtonBuilder().setCustomId('index:last').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
      new ButtonBuilder().setCustomId('index:copy').setLabel('Copy Codes').setStyle(ButtonStyle.Success)
    );

    // send the message
    await safeReply(interaction, { embeds: [embed], components: [row] });
    // stash the session in memory keyed by the sent message id
    const sent = await interaction.fetchReply();
    interaction.client.cache.indexSessions[sent.id] = {
      entries, perPage, totalPages,
      totalCards: entries.length,
      totalCopies, totalStars
    };
  }
};