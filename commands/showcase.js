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
      return interaction.reply({ content: '❌ You must provide at least one valid card code.' });
    }

    const [cards, userInventory] = await Promise.all([
      Card.find({ cardCode: { $in: codes } }),
      UserInventory.findOne({ userId })
    ]);

    if (!cards.length) {
      return interaction.reply({ content: '❌ No cards found for those codes.'});
    }

    const embeds = cards.map(card => {
      const stars = generateStars({ rarity: card.rarity });
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

      return new EmbedBuilder()
        .setTitle(`Card Showcase`)
        .setDescription(desc.join('\n'))
        .setImage(card.discordPermLinkImage || card.imgurImageLink)
        .setFooter({ text: `Pullable: ${card.pullable ? 'Yes' : 'No'}` })
        .setColor('#2f3136');
    });

    let current = 0;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary).setDisabled(current === 0).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new ButtonBuilder().setCustomId('prev').setLabel('◀ Back').setStyle(ButtonStyle.Primary).setDisabled(current >= embeds.length - 1),
      new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(current >= embeds.length - 1),
      new ButtonBuilder().setCustomId('last').setLabel('Last').setStyle(ButtonStyle.Secondary).setDisabled(current >= embeds.length - 1),
    );

    await interaction.reply({ embeds: [embeds[current]], components: [row] });

    const collector = interaction.channel.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      time: 120000 // 2 minutes
    });

    collector.on('collect', async i => {
      await i.deferUpdate();
      if (i.customId === 'first') current = 0;
      if (i.customId === 'prev') current = (current - 1 + embeds.length) % embeds.length;
      if (i.customId === 'next') current = (current + 1) % embeds.length;
      if (i.customId === 'last') current = embeds.length - 1;

      await interaction.editReply({ embeds: [embeds[current]], components: [row] });
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch (e) {
        console.warn('Pagination cleanup failed:', e.message);
      }
    });
  }
};