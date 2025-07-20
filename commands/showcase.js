const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const Card = require('../models/Card');
const UserInventory = require('../models/UserInventory');
const generateStars = require('../utils/starGenerator');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('showcase')
    .setDescription('Show off cards by their codes in a paginated display')
    .addStringOption(opt =>
      opt.setName('cardcodes')
        .setDescription('Comma-separated card codes (e.g. ZB1-RKDR02,BTS-JK01)')
        .setRequired(true)),

  async execute(interaction) {
    const rawInput = interaction.options.getString('cardcodes');
    const codes = rawInput.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
    const userId = interaction.user.id;

    if (!codes.length) {
      return interaction.reply({ content: 'You must provide at least one valid card code.' });
    }

    const [cards, userInventory] = await Promise.all([
      Card.find({ cardCode: { $in: codes } }),
      UserInventory.findOne({ userId })
    ]);

    if (!cards.length) {
      return interaction.reply({ content: 'No cards found for those codes.' });
    }

    const showcaseItems = [];

    for (const card of cards) {
      const stars = generateStars({ rarity: card.rarity, overrideEmoji: card.emoji ?? undefined });
      const owned = userInventory?.cards?.find(c => c.cardCode === card.cardCode);
      const copies = owned?.quantity || 0;

      const desc = [
        `**${stars}**`,
        `**Name:** ${card.name}`,
        ...(card.category?.toLowerCase() === 'kpop' ? [`**Era:** ${card.era}`] : []),
        `**Group:** ${card.group}`,
        `**Card Code:** \`${card.cardCode}\``,
        `**Copies Owned:** ${copies}`,
        `**Designer:** <@${card.designerId || 'Unknown'}>`
      ];

      const embed = new EmbedBuilder()
        .setTitle(`Card Showcase`)
        .setDescription(desc.join('\n'))
        .setFooter({ text: `Pullable: ${card.pullable ? 'Yes' : 'No'}` })
        .setColor('#2f3136');

      let attachment;
      if (card.localImagePath) {
        attachment = new AttachmentBuilder(card.localImagePath, { name: `${card._id}.png` });
        embed.setImage(`attachment://${card._id}.png`);
      }

      showcaseItems.push({
  embed,
  attachment
});
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('show_first').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new ButtonBuilder().setCustomId('show_prev').setStyle(ButtonStyle.Primary).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new ButtonBuilder().setCustomId('show_next').setStyle(ButtonStyle.Primary).setEmoji({ id: '1390462706544410704', name: ':ehx_rightarrow' }),
      new ButtonBuilder().setCustomId('show_last').setStyle(ButtonStyle.Secondary).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' })
    );

    const first = showcaseItems[0];

    await interaction.reply({
      embeds: [first.embed],
      components: [row],
      files: first.attachment ? [first.attachment] : []
    });

    interaction.client.cache = interaction.client.cache || {};
    interaction.client.cache.showcase = interaction.client.cache.showcase || {};
    interaction.client.cache.showcase[userId] = showcaseItems;
  }
};