const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const Card = require('../models/Card');
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

    if (!codes.length) {
      return interaction.reply({ content: '❌ You must provide at least one valid card code.' });
    }

    const cards = await Card.find({ cardCode: { $in: codes } });

    if (!cards.length) {
      return interaction.reply({ content: '❌ No cards found for those codes.' });
    }

    const embeds = cards.map(card => {
      const stars = generateStars({ rarity: card.rarity });
      const desc = [
        `**${stars}**`,
        `**Name:** ${card.name}`,
        ...(card.category?.toLowerCase() === 'kpop' ? [`**Era:** ${card.era}`] : []),
        `**Group:** ${card.group}`,
        `**Card Code:** \`${card.cardCode}\``,
        `**Designer:** <@${card.designerId || 'Unknown'}>`,
        `**Pullable:** ${card.pullable ? '✅ Yes' : '❌ No'}`
      ];

      return new EmbedBuilder()
        .setTitle(`🎴 Card Showcase`)
        .setDescription(desc.join('\n'))
        .setImage(card.discordPermLinkImage || card.imgurImageLink)
        .setColor('#2f3136');
    });

    let current = 0;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('first').setLabel('⏮ First').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('prev').setLabel('◀ Back').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('last').setLabel('Last ⏭').setStyle(ButtonStyle.Secondary)
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