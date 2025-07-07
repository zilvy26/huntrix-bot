const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const drawBinder = require('../../utils/drawBinder');

module.exports = async function(interaction) {
  const targetUser = interaction.options.getUser('user') || interaction.user;
  let currentPage = interaction.options.getInteger('page') ?? 1;

  const renderBinderPage = async (page) => {
    const buffer = await drawBinder(targetUser.id, page);
    return new AttachmentBuilder(buffer, { name: `binder_page${page}.png` });
  };

  await interaction.deferReply();

  const image = await renderBinderPage(currentPage);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('binder_prev').setStyle(ButtonStyle.Primary).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
    new ButtonBuilder().setCustomId('binder_next').setStyle(ButtonStyle.Primary).setEmoji({ id: '1390462706544410704', name: ':ehx_rightarrow' }),
  );

  const msg = await interaction.editReply({
    content: `${targetUser.username}'s Binder — Page ${currentPage}`,
    files: [image],
    components: [row]
  });

  const collector = msg.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 60_000
  });

  collector.on('collect', async i => {
    if (i.customId === 'binder_prev' && currentPage > 1) currentPage--;
    else if (i.customId === 'binder_next' && currentPage < 3) currentPage++;

    await i.deferUpdate();

    const newImage = await renderBinderPage(currentPage);
    await msg.edit({
      content: `${targetUser.username}'s Binder — Page ${currentPage}`,
      components: [row],
      files: [newImage]
});
  });

  collector.on('end', async () => {
    await msg.edit({ components: [] }).catch(() => {});
  });
};