const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const MarketListing = require('../../models/MarketListing');
const User = require('../../models/User');
const generateStars = require('../../utils/starGenerator');

const listingsPerPage = 1;
const maxDefaultPages = 100;

module.exports = async function(interaction) {
  const options = {
    group: interaction.options.getString('group'),
    name: interaction.options.getString('name'),
    rarity: interaction.options.getInteger('rarity'),
    era: interaction.options.getString('era'),
    seller: interaction.options.getUser('seller'),
    cheapest: interaction.options.getBoolean('cheapest'),
    newest: interaction.options.getBoolean('newest'),
    unowned: interaction.options.getBoolean('unowned'),
    page: interaction.options.getInteger('page') || 1
  };

  await renderPreview(interaction, options);
};

async function renderPreview(interaction, options) {
  const {
    group, name, rarity, era, seller,
    cheapest, newest, unowned, page
  } = options;

  const filter = {};
  if (group) filter.group = group;
  if (name) filter.cardName = { $regex: new RegExp(name, 'i') };
  if (rarity) filter.rarity = rarity;
  if (era) filter.era = era;
  if (seller) filter.sellerId = seller.id;
  if (unowned) {
    const userData = await User.findOne({ userId: interaction.user.id });
    if (userData?.cards?.length) {
      filter.cardCode = { $nin: userData.cards.map(c => c.cardCode) };
    }
  }

  const sort = cheapest ? { price: 1 }
             : newest ? { createdAt: -1 }
             : { createdAt: 1 };

  const skip = (page - 1) * listingsPerPage;
  const listings = await MarketListing.find(filter).sort(sort).skip(skip).limit(listingsPerPage).exec();

  if (!listings.length) {
    return interaction.reply({ content: "❌ No listings found for that page or filter." });
  }

  const count = await MarketListing.countDocuments(filter);
  const totalPages = Object.keys(filter).length === 0
    ? Math.min(Math.ceil(count / listingsPerPage), maxDefaultPages)
    : Math.ceil(count / listingsPerPage);

  const listing = listings[0].toObject();
  const stars = generateStars({ rarity: listing.rarity });

  let imageUrl = listing.discordPermalinkImage;
  if (
    !imageUrl ||
    imageUrl.includes('/stickers/') ||
    imageUrl.endsWith('.webp') || imageUrl.endsWith('.json')
  ) {
    imageUrl = listing.imgurImageLink || listing.imageUrl;
  }

  const embed = new EmbedBuilder()
    .setTitle(`🛍️ Stall Preview — Page ${page}/${totalPages}`)
    .setColor('#ffc800')
    .setImage(imageUrl)
    .setDescription(`**${stars} ${listing.cardName}**\n💰 ${listing.price} | 🛒 \`${listing.buyCode}\` | 👤 <@${listing.sellerId}>`)
    .setFooter({ text: `Use /stall buy [buycode] to purchase a card` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('stall_first').setLabel('🔙 First').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId('stall_prev').setLabel('⬅️ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId('stall_next').setLabel('Next ➡️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages),
    new ButtonBuilder().setCustomId('stall_last').setLabel('Last 🔚').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
  );

  if (interaction.replied || interaction.deferred) {
    await interaction.editReply({ embeds: [embed], components: [row] });
  } else {
    await interaction.reply({ embeds: [embed], components: [row] });
  }

  const collector = interaction.channel.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 60000
  });

  collector.on('collect', async i => {
    if (!i.deferred && !i.replied) await i.deferUpdate();

    let newPage = page;
    switch (i.customId) {
      case 'stall_first': newPage = 1; break;
      case 'stall_prev': newPage = Math.max(1, page - 1); break;
      case 'stall_next': newPage = Math.min(totalPages, page + 1); break;
      case 'stall_last': newPage = totalPages; break;
    }

    await renderPreview(i, { ...options, page: newPage });
  });
}