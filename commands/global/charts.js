// commands/charts.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const awaitUserButton = require('../../utils/awaitUserButton');
const ChartSnapshot = require('../../models/ChartSnapshot');

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

const snapshots = await ChartSnapshot.find().lean();

const charts = snapshots
  .map(doc => {
    let matchingSnaps = doc.snapshots.filter(snap =>
  (!groupFilter || snap.group?.toLowerCase() === groupFilter) &&
  (!nameFilter || snap.name?.toLowerCase() === nameFilter) &&
  (!eraFilter || snap.era?.toLowerCase() === eraFilter)
);

if (matchingSnaps.length === 0) return null;

// Sum up totalCards and totalStars across all matching snapshots
let totalCards = matchingSnaps.reduce((sum, snap) => sum + (snap.totalCards || 0), 0);
let totalStars = matchingSnaps.reduce((sum, snap) => sum + (snap.totalStars || 0), 0);

return {
  userId: doc.userId,
  totalCards,
  totalStars
};
  })
  .filter(Boolean);

  const sorted = charts
    .sort((a, b) => sortBy === 'cards' ? b.totalCards - a.totalCards : b.totalStars - a.totalStars)
    .filter(u => (u.totalCards > 0 || u.totalStars > 0))
    .slice(0, 30);

  const pageSize = 10;
  let current = 0;
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));

  const renderEmbed = async (page) => {
    const entries = sorted.slice(page * pageSize, (page + 1) * pageSize);
    const lines = entries.map((entry, i) => {
      const userTag = `<@${entry.userId}>`;
      const metric = sortBy === 'cards'
        ? `Cards: ${entry.totalCards}`
        : `Stars: ${entry.totalStars}`;
      return `**${i + 1 + (page * pageSize)}.** ${userTag} • ${metric}`;
    });

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
}