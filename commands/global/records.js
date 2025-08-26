const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const UserRecord = require('../../models/UserRecord');
const awaitUserButton = require('../../utils/awaitUserButton');
const {safeReply} = require('../../utils/safeReply');

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

    const allLogs = await UserRecord.find({
      userId,
      ...(filterType && { type: filterType })
    }).sort({ createdAt: -1 });

    if (!allLogs.length) {
      return safeReply(interaction, { content: `No records found for ${target.username}.` });
    }

    const logsPerPage = 10;
    const totalPages = Math.ceil(allLogs.length / logsPerPage);
    let current = 0;

    const getPage = (page) => {
      const logs = allLogs.slice(page * logsPerPage, (page + 1) * logsPerPage);
      const embed = new EmbedBuilder()
        .setTitle(`Activity Logs — ${target.username}`)
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
      new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary).setDisabled(page === 0).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
            new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary).setDisabled(page === 0).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
            new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1).setEmoji({ id: '1390462706544410704', name: ':ehx_rightarrow' }),
            new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
    );

    await safeReply(interaction, {
      embeds: [getPage(current)],
      components: [getRow(current)]
    });

    await safeReply(interaction, { embeds: [getPage(current)], components: [getRow()] });
    
        while (true) {
          const btn = await awaitUserButton(interaction, interaction.user.id, ['first', 'prev', 'next', 'last'], 120000);
          if (!btn) break;
    
          if (btn.customId === 'first') current = 0;
          if (btn.customId === 'prev') current = Math.max(0, current - 1);
          if (btn.customId === 'next') current = Math.min(totalPages - 1, current + 1);
          if (btn.customId === 'last') current = totalPages - 1;
    
          await safeReply(interaction, { embeds: [getPage(current)], components: [getRow()] });
        }
    
        // Final cleanup
        try {
          await safeReply(interaction, { components: [] });
        } catch (err) {
          console.warn('Pagination cleanup failed:', err.message);
        }
      }
    };