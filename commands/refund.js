const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../models/User');
const Card = require('../models/Card');
const UserInventory = require('../models/UserInventory');

const REFUND_VALUES = {
  1: 75,
  2: 125,
  3: 200,
  4: 300,
  5: 1000
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refund')
    .setDescription('Refund cards for patterns by card codes or filters')
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('Refund all copies or only duplicates')
        .addChoices(
          { name: 'All Copies', value: 'all' },
          { name: 'Duplicates Only', value: 'dupes' }
        ))
    .addStringOption(opt =>
      opt.setName('cardcodes')
        .setDescription('Comma-separated card codes to refund'))
    .addStringOption(opt =>
      opt.setName('group')
        .setDescription('Group name to filter'))
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Member name to filter'))
    .addStringOption(opt =>
      opt.setName('era')
        .setDescription('Era name to filter'))
    .addStringOption(opt =>
      opt.setName('exclude_name')
        .setDescription('Exclude specific member name'))
    .addStringOption(opt =>
      opt.setName('exclude_era')
        .setDescription('Exclude specific era name'))
    .addBooleanOption(opt =>
      opt.setName('include_specials')
        .setDescription('Include special cards (event, zodiac, others) and R5 game/anime/kpop')),

  async execute(interaction) {
    await interaction.deferReply();
    const userId = interaction.user.id;

    const codesRaw = interaction.options.getString('cardcodes');
    const group = interaction.options.getString('group')?.toLowerCase();
    const name = interaction.options.getString('name')?.toLowerCase();
    const era = interaction.options.getString('era')?.toLowerCase();
    const excludeName = interaction.options.getString('exclude_name')?.toLowerCase();
    const excludeEra = interaction.options.getString('exclude_era')?.toLowerCase();
    const mode = interaction.options.getString('mode') || 'all';
    const includeSpecials = interaction.options.getBoolean('include_specials') || false;
    const inventory = await UserInventory.findOne({ userId });
    if (!inventory || inventory.cards.length === 0) {
      return interaction.editReply('You don’t own any cards to refund.');
    }

    const cardMap = new Map(inventory.cards.map(c => [c.cardCode, c.quantity]));
    let cardsToRefund = [];

    if (codesRaw) {
  const codes = codesRaw.split(',').map(c => c.trim().toUpperCase());

  // Count how many times each code appears
  const codeCounts = {};
  for (const code of codes) {
    codeCounts[code] = (codeCounts[code] || 0) + 1;
  }

  const ownedCodes = Object.keys(codeCounts).filter(c => cardMap.has(c));
  const cardDocs = await Card.find({ cardCode: { $in: ownedCodes } });

  for (const card of cardDocs) {
    const ownedQty = cardMap.get(card.cardCode);
    const requestedQty = codeCounts[card.cardCode] || 0;
    const refundQty = Math.min(ownedQty, requestedQty);
    if (refundQty > 0) cardsToRefund.push({ card, qty: refundQty });
  }

    } else {
      const allCodes = [...cardMap.keys()];
      const cardDocs = await Card.find({ cardCode: { $in: allCodes } });

      for (const card of cardDocs) {
        const qty = cardMap.get(card.cardCode);
        const groupMatch = !group || card.group.toLowerCase() === group;
        const nameMatch = !name || card.name.toLowerCase() === name;
        const eraMatch = !era || (card.era?.toLowerCase() === era);
        const excludeNameMatch = !excludeName || card.name.toLowerCase() !== excludeName;
        const excludeEraMatch = !excludeEra || card.era?.toLowerCase() !== excludeEra;

        if (groupMatch && nameMatch && eraMatch && excludeNameMatch && excludeEraMatch) {
          const refundQty = (mode === 'dupes') ? Math.max(0, qty - 1) : qty;
          if (refundQty > 0) cardsToRefund.push({ card, qty: refundQty });
        }
      }
    }

    if (cardsToRefund.length === 0) {
      return interaction.editReply('No eligible cards found to refund.');
    }

    let totalRefund = 0;
    let refundDetails = [];

    for (const entry of cardsToRefund) {
      const { card, qty } = entry;
      let refundAmount = 0;

      const category = (card.category || '').toLowerCase();
      const isSpecial = card.rarity === 5 && ['event', 'zodiac', 'others'].includes(category);
      const isR5Main = card.rarity === 5 && ['kpop', 'anime', 'game'].includes(category);

  if (card.rarity === 5) {
   if (includeSpecials) {
     if (isSpecial) {
        refundAmount = 2500 * qty;
      } else if (isR5Main) {
        refundAmount = 1000 * qty;
     }
   } else {
    // Don't refund or deduct anything, skip this card
      continue;
   }
  } else {
   refundAmount = (REFUND_VALUES[card.rarity] || 0) * qty;
  }

      totalRefund += refundAmount;
      refundDetails.push(`\`${card.cardCode}\` • R${card.rarity} ×${qty} → +${refundAmount}`);

      // Update inventory
      await UserInventory.updateOne(
        { userId, 'cards.cardCode': card.cardCode },
        { $inc: { 'cards.$.quantity': -qty } }
      );
    }

    await UserInventory.updateOne(
      { userId },
      { $pull: { cards: { quantity: { $lte: 0 } } } }
    );

    await User.updateOne(
      { userId },
      { $inc: { patterns: totalRefund } }
    );

    const embed = new EmbedBuilder()
      .setTitle(`Refund Complete`)
      .setColor('#2f3136')
      .setDescription(`You received **${totalRefund} <:ehx_patterns:1389584144895315978>**`)
      .addFields({ name: 'Details', value: refundDetails.join('\n').slice(0, 1024) });

    return interaction.editReply({ embeds: [embed] });
  }
};