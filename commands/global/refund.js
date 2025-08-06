const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const User = require('../../models/User');
const Card = require('../../models/Card');
const UserInventory = require('../../models/UserInventory');
const safeReply = require('../../utils/safeReply');

const REFUND_VALUES = {
  1: 75,
  2: 125,
  3: 200,
  4: 300,
  5: 2000
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refund')
    .setDescription('Refund cards for patterns by card codes or filters')
    .addBooleanOption(opt =>
      opt.setName('include_specials')
        .setRequired(true)
        .setDescription('Include special cards (event, zodiac, others) and R5 game/anime/kpop'))
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
        .setDescription('Exclude specific era name')),

  async execute(interaction) {
    await interaction.deferReply();
    const userId = interaction.user.id;

    const codesRaw = interaction.options.getString('cardcodes');
    const group = interaction.options.getString('group')?.toLowerCase().split(',').map(s => s.trim());
    const name = interaction.options.getString('name')?.toLowerCase().split(',').map(s => s.trim());
    const era = interaction.options.getString('era')?.toLowerCase().split(',').map(s => s.trim());
    const excludeName = interaction.options.getString('exclude_name')?.toLowerCase().split(',').map(s => s.trim());
    const excludeEra = interaction.options.getString('exclude_era')?.toLowerCase().split(',').map(s => s.trim());
    const mode = interaction.options.getString('mode') || 'all';
    const includeSpecials = interaction.options.getBoolean('include_specials') || false;
    const inventory = await UserInventory.findOne({ userId });
    if (!inventory || inventory.cards.length === 0) {
      return safeReply(interaction, 'You don’t own any cards to refund.');
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
        const groupMatch = !group || group.includes(card.group?.toLowerCase());
        const nameMatch = !name || name.includes(card.name?.toLowerCase());
        const eraMatch = !era || era.includes(card.era?.toLowerCase());
        const excludeNameMatch = !excludeName || !excludeName.includes(card.name?.toLowerCase());
        const excludeEraMatch = !excludeEra || !excludeEra.includes(card.era?.toLowerCase());

        if (groupMatch && nameMatch && eraMatch && excludeNameMatch && excludeEraMatch) {
          const refundQty = (mode === 'dupes') ? Math.max(0, qty - 1) : qty;
          if (refundQty > 0) cardsToRefund.push({ card, qty: refundQty });
        }
      }
    }

    let previewPage = 0;
const perPage = 10;
const totalPages = Math.ceil(cardsToRefund.length / perPage);

const makePreviewEmbed = () => {
  const slice = cardsToRefund.slice(previewPage * perPage, previewPage * perPage + perPage);
  return {
    title: `Refund Preview (${cardsToRefund.length} cards total)`,
    description: slice.map(entry =>
      `\`${entry.card.cardCode}\` • R${entry.card.rarity} ×${entry.qty}`
    ).join('\n'),
    footer: { text: `Page ${previewPage + 1} of ${totalPages}` }
  };
};

const makeButtons = () => {
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary).setDisabled(previewPage === 0).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
    new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary).setDisabled(previewPage === 0).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
    new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary).setDisabled(previewPage >= totalPages - 1).setEmoji({ id: '1390462706544410704', name: ':ehx_rightarrow' }),
    new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary).setDisabled(previewPage >= totalPages - 1).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' })
  );

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('confirm_refund').setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cancel_refund').setLabel('Cancel').setStyle(ButtonStyle.Danger)
  );

  return [navRow, confirmRow];
};

let msg = await safeReply(interaction, {
  embeds: [makePreviewEmbed()],
  components: makeButtons()
});

while (true) {
  const btn = await msg.awaitMessageComponent({
    filter: i => i.user.id === interaction.user.id,
    time: 20000
  }).catch(() => null);

  if (!btn) {
  await safeReply(interaction, { content: 'Timed out. Refund cancelled.', components: [], embeds: [] });
  return;
}

if (btn.customId === 'cancel_refund') {
  await btn.update({ content: 'Refund cancelled.', components: [], embeds: [] });
  return;
}

  if (btn.customId === 'confirm_refund') {
    await btn.update({ content: 'Processing refund...', components: [], embeds: [] });
    break;
  }

  if (btn.customId === 'first') previewPage = 0;
  if (btn.customId === 'prev') previewPage = Math.max(0, previewPage - 1);
  if (btn.customId === 'next') previewPage = Math.min(totalPages - 1, previewPage + 1);
  if (btn.customId === 'last') previewPage = totalPages - 1;

  await btn.update({ embeds: [makePreviewEmbed()], components: makeButtons() });
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
        refundAmount = 3750 * qty;
      } else if (isR5Main) {
        refundAmount = 2000 * qty;
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

    return safeReply(interaction, { embeds: [embed] });
  }
};