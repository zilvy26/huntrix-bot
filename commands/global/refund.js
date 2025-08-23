// commands/global/refund.js
const { SlashCommandBuilder } = require('discord.js');
const User = require('../../models/User');
const Card = require('../../models/Card');
const UserInventory = require('../../models/UserInventory');
const safeReply = require('../../utils/safeReply');
const { registerRefundSession } = require('../../utils/refundSession');

const REFUND_VALUES = { 1: 75, 2: 125, 3: 200, 4: 300, 5: 2000 };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refund')
    .setDescription('Refund cards for patterns by card codes or filters')
    .addBooleanOption(o => o.setName('include_specials').setRequired(true)
      .setDescription('Include special cards (event, zodiac, others) and R5 game/anime/kpop'))
    .addStringOption(o => o.setName('mode').setDescription('Refund all copies or only duplicates')
      .addChoices({ name: 'All Copies', value: 'all' }, { name: 'Duplicates Only', value: 'dupes' }))
    .addStringOption(o => o.setName('cardcodes').setDescription('Comma-separated card codes to refund'))
    .addStringOption(o => o.setName('group').setDescription('Group name to filter (comma-separated)'))
    .addStringOption(o => o.setName('name').setDescription('Member name to filter (comma-separated)'))
    .addStringOption(o => o.setName('era').setDescription('Era name to filter (comma-separated)'))
    .addStringOption(o => o.setName('exclude_name').setDescription('Exclude specific member name(s)'))
    .addStringOption(o => o.setName('exclude_era').setDescription('Exclude specific era name(s)'))
    .setDMPermission(true),

  async execute(interaction) {
    const userId = interaction.user.id;

    const toList = s => s?.toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
    const codesRaw = interaction.options.getString('cardcodes');
    const group = toList(interaction.options.getString('group'));
    const name  = toList(interaction.options.getString('name'));
    const era   = toList(interaction.options.getString('era'));
    const excludeName = toList(interaction.options.getString('exclude_name'));
    const excludeEra  = toList(interaction.options.getString('exclude_era'));
    const mode = interaction.options.getString('mode') || 'all';
    const includeSpecials = interaction.options.getBoolean('include_specials') || false;

    const inv = await UserInventory.findOne({ userId });
    if (!inv || inv.cards.length === 0) {
      return safeReply(interaction, 'You don’t own any cards to refund.');
    }

    const cardMap = new Map(inv.cards.map(c => [c.cardCode, c.quantity]));
    const items = [];

    if (codesRaw) {
      const codes = codesRaw.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
      const counts = {};
      for (const c of codes) counts[c] = (counts[c] || 0) + 1;
      const owned = Object.keys(counts).filter(c => cardMap.has(c));
      const docs = await Card.find({ cardCode: { $in: owned } });
      for (const card of docs) {
        const have = cardMap.get(card.cardCode);
        const want = counts[card.cardCode] || 0;
        const qty = Math.min(have, want);
        if (qty > 0) items.push({ cardCode: card.cardCode, rarity: card.rarity, qty });
      }
    } else {
      const allCodes = [...cardMap.keys()];
      const docs = await Card.find({ cardCode: { $in: allCodes } });
      for (const card of docs) {
        const qtyOwned = cardMap.get(card.cardCode);
        const groupMatch = !group || group.includes(card.group?.toLowerCase());
        const nameMatch  = !name  || name.includes(card.name?.toLowerCase());
        const eraMatch   = !era   || era.includes(card.era?.toLowerCase());
        const notExName  = !excludeName || !excludeName.includes(card.name?.toLowerCase());
        const notExEra   = !excludeEra  || !excludeEra.includes(card.era?.toLowerCase());
        if (groupMatch && nameMatch && eraMatch && notExName && notExEra) {
          const qty = (mode === 'dupes') ? Math.max(0, qtyOwned - 1) : qtyOwned;
          if (qty > 0) items.push({ cardCode: card.cardCode, rarity: card.rarity, qty });
        }
      }
    }

    if (items.length === 0) {
      return safeReply(interaction, 'No cards match your filters to refund.');
    }

    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(items.length / perPage));

    const preview = await safeReply(interaction, {
      embeds: [{
        title: `Refund Preview (${items.length} cards total)`,
        description: items.slice(0, perPage).map(e => `\`${e.cardCode}\` • R${e.rarity} ×${e.qty}`).join('\n'),
        footer: { text: `Page 1 of ${totalPages}` }
      }],
      components: [
        {
          type: 1, components: [
            { type: 2, style: 2, custom_id: 'first', disabled: true,  emoji: { id: '1390467720142651402', name: 'ehx_leftff' } },
            { type: 2, style: 1, custom_id: 'prev',  disabled: true,  emoji: { id: '1390462704422096957', name: 'ehx_leftarrow' } },
            { type: 2, style: 1, custom_id: 'next',  disabled: items.length <= perPage, emoji: { id: '1390462706544410704', name: 'ehx_rightarrow' } }, // fixed name
            { type: 2, style: 2, custom_id: 'last',  disabled: items.length <= perPage, emoji: { id: '1390467723049439483', name: 'ehx_rightff' } }
          ]
        },
        { type: 1, components: [
          { type: 2, style: 3, custom_id: 'confirm_refund', label: 'Confirm' },
          { type: 2, style: 4, custom_id: 'cancel_refund',  label: 'Cancel'  }
        ]}
      ]
    });

    if (preview?.id) {
      registerRefundSession({
        message: preview,
        userId,
        items,
        includeSpecials,
        mode,
        perPage
      });
    }
  }
};

module.exports.REFUND_VALUES = REFUND_VALUES;