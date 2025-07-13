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

let activeCollector = null;

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
    return interaction.reply({ content: "No listings found for that page or filter." });
  }

  const count = await MarketListing.countDocuments(filter);
  const totalPages = Object.keys(filter).length === 0
    ? Math.min(Math.ceil(count / listingsPerPage), maxDefaultPages)
    : Math.ceil(count / listingsPerPage);

  const listing = listings[0].toObject();
  const stars = generateStars({ rarity: listing.rarity, overrideEmoji: listing.emoji });

  let imageUrl = listing.discordPermalinkImage;
  if (
    !imageUrl ||
    imageUrl.includes('/stickers/') ||
    imageUrl.endsWith('.webp') || imageUrl.endsWith('.json')
  ) {
    imageUrl = listing.imgurImageLink || listing.imageUrl;
  }

  const embed = new EmbedBuilder()
    .setTitle(`Stall Preview — Page ${page}/${totalPages}`)
    .setColor('#ffc800')
    .setImage(imageUrl)
    .setDescription(`**${stars} ${listing.cardName}**\n<:ehx_patterns:1389584144895315978> ${listing.price} | 🛒 \`${listing.buyCode}\` | 👤 <@${listing.sellerId}>`)
    .setFooter({ text: `Use /stall buy [buycode] to purchase a card` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('stall_first').setStyle(ButtonStyle.Secondary).setDisabled(page === 0).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
    new ButtonBuilder().setCustomId('stall_prev').setStyle(ButtonStyle.Primary).setDisabled(page === 0).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
    new ButtonBuilder().setCustomId('stall_next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages).setEmoji({ id: '1390462706544410704', name: ':ehx_rightarrow' }),
    new ButtonBuilder().setCustomId('stall_last').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
  );

  if (interaction.replied || interaction.deferred) {
    await interaction.editReply({ embeds: [embed], components: [row] });
  } else {
    await interaction.reply({ embeds: [embed], components: [row] });
  }

  const replyMessage = interaction.replied ? await interaction.fetchReply() : null;

  if (activeCollector) {
    
    activeCollector.stop('replaced');
  }

  const collector = replyMessage?.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 60000
  });

  activeCollector = collector;

  collector.on('collect', async i => {
    

    try {
      if (!i.deferred && !i.replied) {
        
        await i.deferUpdate();
      }

      let newPage = page;
      switch (i.customId) {
        case 'stall_first': newPage = 1; break;
        case 'stall_prev': newPage = Math.max(1, page - 1); break;
        case 'stall_next': newPage = Math.min(totalPages, page + 1); break;
        case 'stall_last': newPage = totalPages; break;
      }

      
      await renderPreview(i, { ...options, page: newPage });

    } catch (err) {
      console.error(`[Collector] Error during interaction handling: ${err}`);
    }
  });

  collector.on('end', (_, reason) => {
    
  });
}