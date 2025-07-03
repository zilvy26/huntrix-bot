// commands/charts.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const Chart = require('../models/Chart');
const Card = require('../models/Card');
const UserInventory = require('../models/UserInventory');
const awaitUserButton = require('../utils/awaitUserButton');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('charts')
    .setDescription('View chart rankings')
    .addStringOption(opt =>
      opt.setName('sortby')
        .setDescription('Sort by total cards or total stars')
        .addChoices(
          { name: 'Total Cards', value: 'cards' },
          { name: 'Total Stars', value: 'stars' }
        )
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('group')
        .setDescription('Filter by one group (optional)'))
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Filter by one name (optional)'))
    .addStringOption(opt =>
      opt.setName('era')
        .setDescription('Filter by one era (optional)')),

  async execute(interaction) {
    await interaction.deferReply();

    const sortBy = interaction.options.getString('sortby');
    const groupFilter = interaction.options.getString('group')?.toLowerCase();
    const nameFilter = interaction.options.getString('name')?.toLowerCase();
    const eraFilter = interaction.options.getString('era')?.toLowerCase();

    const charts = await Chart.find().lean(); // Only users who ran /refreshcharts
    const allInventories = await UserInventory.find().lean();
    const allCardCodes = allInventories.flatMap(i => i.cards.map(c => c.cardCode));
    const cardDocs = await Card.find({ cardCode: { $in: allCardCodes } });

    const enriched = [];

    for (const user of charts) {
      const inv = allInventories.find(i => i.userId === user.userId);
      if (!inv) continue;

      let totalCards = 0;
      let totalStars = 0;

      for (const entry of inv.cards) {
        const card = cardDocs.find(c => c.cardCode === entry.cardCode);
        if (!card) continue;
        const groupMatch = !groupFilter || card.group.toLowerCase() === groupFilter;
        const nameMatch = !nameFilter || card.name.toLowerCase() === nameFilter;
        const eraMatch = !eraFilter || card.era.toLowerCase() === eraFilter;

        if (groupMatch && nameMatch && eraMatch) {
          totalCards += entry.quantity;
          totalStars += card.rarity * entry.quantity;
        }
      }

      enriched.push({
        userId: user.userId,
        totalCards,
        totalStars
      });
    }

    const sorted = enriched.sort((a, b) => {
      return sortBy === 'cards' ? b.totalCards - a.totalCards : b.totalStars - a.totalStars;
    }).filter(u => (u.totalCards > 0 || u.totalStars > 0));

    const pageSize = 10;
    let current = 0;
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));

    const renderEmbed = async (page) => {
      const entries = sorted.slice(page * pageSize, (page + 1) * pageSize);
      const lines = await Promise.all(entries.map(async (entry, i) => {
  const userTag = `<@${entry.userId}>`;
  const metric = sortBy === 'cards'
    ? `Cards: ${entry.totalCards}`
    : `Stars: ${entry.totalStars}`;
  return `**${i + 1 + (page * pageSize)}.** ${userTag} • ${metric}`;
}));

      return new EmbedBuilder()
        .setTitle(`📊 Chart Rankings (${sortBy === 'cards' ? 'Cards' : 'Stars'})`)
        .setColor('#2f3136')
        .setDescription(lines.join('\n\n') || 'No matching users.')
        .setFooter({ text: `Page ${page + 1} of ${totalPages}` });
    };

    const renderRow = () => new ActionRowBuilder().addComponents(
                  new ButtonBuilder().setCustomId('first').setLabel('⏮ First').setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
                  new ButtonBuilder().setCustomId('prev').setLabel('◀ Back').setStyle(ButtonStyle.Primary).setDisabled(current === 0),
                  new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(current >= totalPages - 1),
                  new ButtonBuilder().setCustomId('last').setLabel('Last ⏭').setStyle(ButtonStyle.Secondary).setDisabled(current >= totalPages - 1)
                );
            
                await interaction.editReply({ embeds: [await renderEmbed(current)], components: [renderRow()] });
            
                while (true) {
                  const btn = await awaitUserButton(interaction, interaction.user.id, ['first', 'prev', 'next', 'last'], 120000);
                  if (!btn) break;
            
                  if (btn.customId === 'first') current = 0;
                  if (btn.customId === 'prev') current = Math.max(0, current - 1);
                  if (btn.customId === 'next') current = Math.min(totalPages - 1, current + 1);
                  if (btn.customId === 'last') current = totalPages - 1;
            
                  await interaction.editReply({ embeds: [renderEmbed(current)], components: [renderRow()] });
                }
            
                // Final cleanup
                try {
                  await interaction.editReply({ components: [] });
                } catch (err) {
                  console.warn('Pagination cleanup failed:', err.message);
                }
              }
            };