// commands/global/subcommands/stallpreview.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const MarketListing = require('../../../models/MarketListing');
const User = require('../../../models/User');
const generateStars = require('../../../utils/starGenerator');
const { stallPreviewFilters } = require('../../../utils/cache');
const UserInventory = require('../../../models/UserInventory');
const { safeReply } = require('../../../utils/safeReply');

const listingsPerPage = 1;
const maxDefaultPages = 200;

module.exports = async function (interaction, incomingOptions = {}) {
  const isButton = interaction.isButton?.(); // button = pagination
  let options;

  if (isButton) {
    // Router passes filters + page here
    options = incomingOptions;
  } else {
    // Slash command options
    options = {
      group: interaction.options.getString('group'),
      name: interaction.options.getString('name'),
      rarity: interaction.options.getInteger('rarity'),
      era: interaction.options.getString('era'),
      seller: interaction.options.getUser('seller'),
      cheapest: interaction.options.getBoolean('cheapest'),
      newest: interaction.options.getBoolean('newest'),
      unowned: interaction.options.getBoolean('unowned'),
      page: interaction.options.getInteger('page') || 1,
      delivery: incomingOptions.delivery // allow router hint, just in case
    };
  }

  return renderPreview(interaction, options);
};

async function renderPreview(interaction, options) {
  const {
    group, name, rarity, era, seller,
    cheapest, newest, unowned, page,
    delivery
  } = options;

  const filter = {};
  if (group) filter.group = group;
  if (name) filter.cardName = { $regex: new RegExp(name, 'i') };
  if (rarity) filter.rarity = rarity;
  if (era) filter.era = era;
  if (seller) filter.sellerId = seller.id;

  if (unowned) {
    const inventory = await UserInventory.findOne({ userId: interaction.user.id });
    const ownedCodes = inventory?.cards.map(c => c.cardCode) || [];
    filter.cardCode = { $nin: ownedCodes };
  }
  const sort = cheapest ? { price: 1 }
    : newest ? { createdAt: -1 }
    : { createdAt: 1 };

  const skip = (page - 1) * listingsPerPage;
  const listings = await MarketListing.find(filter).sort(sort).skip(skip).limit(listingsPerPage).exec();
  if (!listings.length) {
    // For buttons: edit with a simple notice; for slash: just reply
    const payload = { content: 'No listings found for that page or filter.', components: [] };
    if (interaction.isButton?.() || delivery === 'update') {
      return interaction.editReply(payload).catch(() => {});
    }
    return safeReply(interaction, payload);
  }

  const count = await MarketListing.countDocuments(filter);
  const totalPages = Object.keys(filter).length === 0
    ? Math.min(Math.ceil(count / listingsPerPage), maxDefaultPages)
    : Math.ceil(count / listingsPerPage);

  const listing = listings[0].toObject();
  const stars = generateStars({ rarity: listing.rarity, overrideEmoji: listing.emoji });

  // Image selection
  const imageUrl = listing.localImagePath
    ? `attachment://${listing._id}.png`
    : (listing.discordPermalinkImage || listing.imgurImageLink || listing.imageUrl);

  const files = listing.localImagePath
    ? [{ attachment: listing.localImagePath, name: `${listing._id}.png` }]
    : [];

  const embed = new EmbedBuilder()
    .setTitle(`Stall Preview — Page ${page}/${totalPages}`)
    .setColor('#ffc800')
    .setImage(imageUrl)
    .setDescription(
      `**${stars} ${listing.cardName}**\n` +
      `**Card Code** : \`${listing.cardCode}\`\n` +
      `**Price** : <:ehx_patterns:1389584144895315978> ${listing.price}\n` +
      `**Buy Code** : \`${listing.buyCode}\`\n` +
      `**Seller** : <@${listing.sellerId}>`
    )
    .setFooter({ text: 'Use /stall buy [buycode] to purchase cards' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('stall_first').setStyle(ButtonStyle.Secondary).setDisabled(page === 1).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
    new ButtonBuilder().setCustomId('stall_prev').setStyle(ButtonStyle.Primary).setDisabled(page === 1).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
    // 🔧 fix: remove leading colon in name
    new ButtonBuilder().setCustomId('stall_next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages).setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
    new ButtonBuilder().setCustomId('stall_last').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
  );

  const payload = { embeds: [embed], components: [row], files };

  // 💡 Key behavior:
  // - Slash command → reply via safeReply
  // - Button press (or explicit delivery=update) → edit existing message
  if (interaction.isButton?.() || delivery === 'update') {
    await interaction.editReply(payload).catch(() => {});
  } else {
    await safeReply(interaction, payload);
  }

  // Cache filters against the message ID so the router can read them for pagination
  let replyMessage = null;
  try {
    replyMessage = await interaction.fetchReply();
  } catch {
    // ignore
  }

  if (replyMessage?.id) {
    stallPreviewFilters.set(replyMessage.id, {
      group, name, rarity, era, seller, cheapest, newest, unowned, page
    });

    // Cleanup + disable buttons after 10 minutes
    setTimeout(async () => {
      stallPreviewFilters.delete(replyMessage.id);
      try {
        const disabledRow = new ActionRowBuilder().addComponents(
          row.components.map(btn => ButtonBuilder.from(btn).setDisabled(true))
        );
        await replyMessage.edit({ components: [disabledRow] });
      } catch (err) {
        console.warn('❌ Failed to disable buttons after timeout:', err?.message || err);
      }
    }, 10 * 60 * 1000);
  }
}