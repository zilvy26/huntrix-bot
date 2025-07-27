// commands/charts.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const Chart = require('../../models/Chart');
const Card = require('../../models/Card');
const UserInventory = require('../../models/UserInventory');
const awaitUserButton = require('../../utils/awaitUserButton');

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

    const charts = await Chart.find().lean();

    const enriched = [];

    for (const user of charts) {
  const inv = await UserInventory.findOne({ userId: user.userId }).lean();
  if (!inv) continue;

  const cardCodes = inv.cards.map(c => c.cardCode);
  const cardDocs = await Card.find({ cardCode: { $in: cardCodes } }).lean();

  // Check if the user has at least one matching card if filters applied
  if (groupFilter || nameFilter || eraFilter) {
    const hasMatch = cardDocs.some(card => {
      const groupMatch = !groupFilter || card.group?.toLowerCase() === groupFilter;
      const nameMatch = !nameFilter || card.name?.toLowerCase() === nameFilter;
      const eraMatch = !eraFilter || card.era?.toLowerCase() === eraFilter;
      return groupMatch && nameMatch && eraMatch;
    });

    if (!hasMatch) continue;
  }

  // ✅ Always use pre-saved stats
  enriched.push({
    userId: user.userId,
    totalCards: user.totalCards,
    totalStars: user.totalStars
  });
}

    const sorted = enriched
      .sort((a, b) => sortBy === 'cards' ? b.totalCards - a.totalCards : b.totalStars - a.totalStars)
      .filter(u => (u.totalCards > 0 || u.totalStars > 0))
      .slice(0, 30);

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

      const filters = [
        groupFilter ? `Group: ${groupFilter}` : null,
        nameFilter ? `Name: ${nameFilter}` : null,
        eraFilter ? `Era: ${eraFilter}` : null
      ].filter(Boolean).join(' | ');

      const filterTitle = filters ? `Filtered by ${filters}` : (sortBy === 'cards' ? 'Cards' : 'Stars');

      return new EmbedBuilder()
        .setTitle(`Chart Rankings (${filterTitle})`)
        .setColor('#2f3136')
        .setDescription(lines.join('\n\n') || 'No matching users.')
        .setFooter({ text: `Page ${page + 1} of ${totalPages}` });
    };

    const renderRow = () => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary).setDisabled(current === 0).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary).setDisabled(current === 0).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary).setDisabled(current >= totalPages - 1).setEmoji({ id: '1390462706544410704', name: ':ehx_rightarrow' }),
      new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary).setDisabled(current >= totalPages - 1).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
    );

    await interaction.editReply({ embeds: [await renderEmbed(current)], components: [renderRow()] });

    while (true) {
      const btn = await awaitUserButton(interaction, interaction.user.id, ['first', 'prev', 'next', 'last'], 120000);
      if (!btn) break;

      if (btn.customId === 'first') current = 0;
      if (btn.customId === 'prev') current = Math.max(0, current - 1);
      if (btn.customId === 'next') current = Math.min(totalPages - 1, current + 1);
      if (btn.customId === 'last') current = totalPages - 1;

      await interaction.editReply({ embeds: [await renderEmbed(current)], components: [renderRow()] });
    }

    try {
      await interaction.editReply({ components: [] });
    } catch (err) {
      console.warn('Pagination cleanup failed:', err.message);
    }
  }
};