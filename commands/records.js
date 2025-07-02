const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const UserRecord = require('../models/UserRecord');
const awaitUserButton = require('../utils/awaitUserButton');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('records')
    .setDescription('View activity logs for yourself or another user')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Whose logs do you want to see?')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Filter by log type (e.g. pay, pull, pull10, rehearsal, receive)')
        .setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const filterType = interaction.options.getString('type');
    const userId = target.id;

    await interaction.deferReply();

    const allLogs = await UserRecord.find({
      userId,
      ...(filterType && { type: filterType })
    }).sort({ createdAt: -1 });

    if (!allLogs.length) {
      return interaction.editReply({ content: `📭 No records found for ${target.username}.` });
    }

    const logsPerPage = 10;
    const totalPages = Math.ceil(allLogs.length / logsPerPage);
    let current = 0;

    const getPage = (page) => {
      const logs = allLogs.slice(page * logsPerPage, (page + 1) * logsPerPage);
      const embed = new EmbedBuilder()
        .setTitle(`📑 Activity Logs — ${target.username}`)
        .setColor('#2f3136')
        .setDescription(
          logs.map(log => {
            const t = `<t:${Math.floor(log.createdAt.getTime() / 1000)}:R>`;
            return `• **[${log.type.toUpperCase()}]** ${log.detail} (${t})`;
          }).join('\n')
        )
        .setFooter({ text: `Page ${page + 1} of ${totalPages}` });

      return embed;
    };

    const getRow = (page) => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('first').setLabel('⏮ First').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId('prev').setLabel('◀ Back').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
      new ButtonBuilder().setCustomId('last').setLabel('Last ⏭').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
    );

    await interaction.editReply({
      embeds: [getPage(current)],
      components: [getRow(current)]
    });

    while (true) {
      const btn = await awaitUserButton(interaction, interaction.user, ['first', 'prev', 'next', 'last'], 120000);
      if (!btn) break;

      await btn.deferUpdate();

      if (btn.customId === 'first') current = 0;
      if (btn.customId === 'prev') current = Math.max(current - 1, 0);
      if (btn.customId === 'next') current = Math.min(current + 1, totalPages - 1);
      if (btn.customId === 'last') current = totalPages - 1;

      await interaction.editReply({
        embeds: [getPage(current)],
        components: [getRow(current)]
      });
    }

    try {
      await interaction.editReply({ components: [] });
    } catch (err) {
      console.warn('Pagination cleanup failed:', err.message);
    }
  }
};