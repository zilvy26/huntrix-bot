const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const Card = require('../models/Card');
const UserInventory = require('../models/UserInventory');
const generateStars = require('../utils/starGenerator');
const awaitUserButton = require('../utils/awaitUserButton');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('index')
    .setDescription('View your inventory with filters and pagination.')
    .addUserOption(opt => opt.setName('user').setDescription('Whose inventory to view?'))
    .addStringOption(opt => opt.setName('group').setDescription('Filter by group'))
    .addStringOption(opt => opt.setName('era').setDescription('Filter by era'))
    .addStringOption(opt => opt.setName('name').setDescription('Filter by card name'))
    .addStringOption(opt => opt.setName('rarity').setDescription('Filter by rarity'))
    .addStringOption(opt =>
      opt.setName('show')
        .setDescription('Which cards to show')
        .addChoices(
          { name: 'Owned Only', value: 'owned' },
          { name: 'Missing Only', value: 'missing' },
          { name: 'All', value: 'all' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const user = interaction.options.getUser('user') || interaction.user;
    const parseList = (input) =>
  input?.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) || [];

const filters = {
  groups: parseList(interaction.options.getString('group')),
  eras: parseList(interaction.options.getString('era')),
  names: parseList(interaction.options.getString('name')),
  rarities: parseList(interaction.options.getString('rarity')),
  show: interaction.options.getString('show') || 'owned'
};

    const allCards = await Card.find({});
    const invDoc = await UserInventory.findOne({ userId: user.id });
    const inventoryMap = new Map(invDoc?.cards.map(c => [c.cardCode, c.quantity]) || []);

    const cardList = allCards.filter(card => {
  const inInv = inventoryMap.has(card.cardCode);
  const groupMatch = !filters.groups.length || filters.groups.includes(card.group.toLowerCase());
  const eraMatch = !filters.eras.length || filters.eras.includes((card.era || '').toLowerCase());
  const nameMatch = !filters.names.length || filters.names.includes(card.name.toLowerCase());
  const rarityMatch = !filters.rarities.length || filters.rarities.includes(String(card.rarity));

  if (!(groupMatch && eraMatch && nameMatch && rarityMatch)) return false;
  if (filters.show === 'owned') return inInv;
  if (filters.show === 'missing') return !inInv;
  return true;
});
    cardList.sort((a, b) => parseInt(b.rarity) - parseInt(a.rarity));

    if (!cardList.length) {
      return interaction.editReply({ content: '📭 No cards match your filters.' });
    }

    const totalCopies = cardList.reduce((acc, card) => acc + (inventoryMap.get(card.cardCode) || 0), 0);
    const totalStars = cardList.reduce((acc, card) => acc + (card.rarity * (inventoryMap.get(card.cardCode) || 0)), 0);

    const perPage = 6;
    const totalPages = Math.ceil(cardList.length / perPage);
    let page = 0;

    const makeEmbed = (pg) => {
      const slice = cardList.slice(pg * perPage, pg * perPage + perPage);
      const description = slice.map(card => {
        const copies = inventoryMap.get(card.cardCode) || 0;
        const stars = generateStars({ rarity: card.rarity });
        return `**${stars} ${card.name}**\nGroup: ${card.group}${card.category?.toLowerCase() === 'kpop' && card.era ? ` | Era: ${card.era}` : ''} | Code: \`${card.cardCode}\` | Copies: ${copies}`;
      }).join('\n\n');

      return new EmbedBuilder()
        .setTitle(`📦 ${user.username}'s Inventory`)
        .setDescription(description)
        .setColor('#FF69B4')
        .setFooter({
          text: `Page ${pg + 1} of ${totalPages} • Total Cards: ${cardList.length} • Total Copies: ${totalCopies} • Total Stars: ${totalStars}`
        });
    };

    const makeRow = () => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('first').setLabel('⏮').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId('prev').setLabel('◀').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId('next').setLabel('▶').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
      new ButtonBuilder().setCustomId('last').setLabel('⏭').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
      new ButtonBuilder().setCustomId('copy').setLabel('📋 Copy Codes').setStyle(ButtonStyle.Success)
    );

    await interaction.editReply({ embeds: [makeEmbed(page)], components: [makeRow()] });

    while (true) {
      const btn = await awaitUserButton(interaction, interaction.user.id, ['first', 'prev', 'next', 'last', 'copy'], 120_000);
      if (!btn) break;

      if (btn.customId === 'first') page = 0;
      else if (btn.customId === 'prev') page = Math.max(page - 1, 0);
      else if (btn.customId === 'next') page = Math.min(page + 1, totalPages - 1);
      else if (btn.customId === 'last') page = totalPages - 1;
      else if (btn.customId === 'copy') {
        const slice = cardList.slice(page * perPage, page * perPage + perPage);
        const codes = slice.map(c => c.cardCode).join(', ');
        await btn.editReply({ content: `🧾 Codes:\n\`\`\`${codes}\`\`\`` });
        continue;
      }

      await interaction.editReply({ embeds: [makeEmbed(page)], components: [makeRow()] });
    }

    await interaction.editReply({ components: [] });
  }
};