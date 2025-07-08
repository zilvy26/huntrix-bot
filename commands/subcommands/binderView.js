const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const drawBinder = require('../../utils/drawBinder');

module.exports = async function(interaction) {
  const targetUser = interaction.options.getUser('user') || interaction.user;
  let currentPage = interaction.options.getInteger('page') ?? 1;

  const buffer = await drawBinder(targetUser.id, currentPage);
  const image = new AttachmentBuilder(buffer, { name: `binder_page${currentPage}.png` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`binder_prev:${targetUser.id}:${currentPage}`).setStyle(ButtonStyle.Primary).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
    new ButtonBuilder().setCustomId(`binder_next:${targetUser.id}:${currentPage}`).setStyle(ButtonStyle.Primary).setEmoji({ id: '1390462706544410704', name: ':ehx_rightarrow' })
  );

  // Only reply once — don't re-handle interaction buttons
    await interaction.reply({
      content: `${targetUser.username}'s Binder — Page ${currentPage}`,
      files: [image],
      components: [row]
    });
};