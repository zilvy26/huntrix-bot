// commands/global/refund.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const Card = require('../../models/Card');
const InventoryItem = require('../../models/InventoryItem'); // ✅ NEW
const { registerRefundSession } = require('../../utils/refundSession');

// Values for R1–R4; R5 handled in session (specials vs main)
const REFUND_VALUES = Object.freeze({
  1: 75,
  2: 125,
  3: 200,
  4: 300
  // 5 is computed in refundSession (2500 / 3750) like your original, only when include_specials = true
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refund')
    .setDescription('Refund cards for patterns')
    .addBooleanOption(o => o.setName('include_specials').setDescription('Include R5 specials (event/zodiac/others)?').setRequired(true))
    .addStringOption(o =>
      o.setName('mode')
        .setDescription('all = all copies, dupes = keep one')
        .addChoices({ name: 'all', value: 'all' }, { name: 'dupes', value: 'dupes' })
    )
    .addStringOption(o => o.setName('cardcodes').setDescription('Comma-separated card codes to refund (optional)'))
    .addStringOption(o => o.setName('group').setDescription('Filter by groups (comma-separated)'))
    .addStringOption(o => o.setName('name').setDescription('Filter by names (comma-separated)'))
    .addStringOption(o => o.setName('era').setDescription('Filter by eras (comma-separated)'))
    .addStringOption(o => o.setName('exclude_name').setDescription('Exclude names (comma-separated)'))
    .addStringOption(o => o.setName('exclude_era').setDescription('Exclude eras (comma-separated)'))
    .addStringOption(o => o.setName('rarityrange').setDescription('Use "3" or "2-5"')),

  async execute(interaction) {
    const userId = interaction.user.id;

    // helpers
    const toList = (s) => (s ? s.toLowerCase().split(',').map(x => x.trim()).filter(Boolean) : []);
    const codesRaw = interaction.options.getString('cardcodes');
    const group = toList(interaction.options.getString('group'));
    const name  = toList(interaction.options.getString('name'));
    const era   = toList(interaction.options.getString('era'));
    const excludeName = toList(interaction.options.getString('exclude_name'));
    const excludeEra  = toList(interaction.options.getString('exclude_era'));
    const mode = (interaction.options.getString('mode') || 'all').toLowerCase();
    const includeSpecials = Boolean(interaction.options.getBoolean('include_specials'));

    // rarity parsing "3" | "2-5"
    const rr = (interaction.options.getString('rarityrange') || '').trim();
    let minRarity = 1, maxRarity = 5;
    if (rr) {
      const mRange = rr.match(/^(\d+)\s*-\s*(\d+)$/);
      const mSingle = rr.match(/^(\d+)$/);
      if (mRange) {
        minRarity = Math.max(1, Math.min(5, parseInt(mRange[1], 10)));
        maxRarity = Math.max(1, Math.min(5, parseInt(mRange[2], 10)));
        if (minRarity > maxRarity) [minRarity, maxRarity] = [maxRarity, minRarity];
      } else if (mSingle) {
        minRarity = maxRarity = Math.max(1, Math.min(5, parseInt(mSingle[1], 10)));
      } else {
        return interaction.reply({ content: 'Invalid rarity format. Use `3` or `2-5`.', ephemeral: true });
      }
    }

    // 1) Load owned rows from InventoryItem
    const itemsRows = await InventoryItem.find(
      { userId },
      { _id: 0, cardCode: 1, quantity: 1 }
    ).lean();

    if (!itemsRows.length) {
      return interaction.reply({ content: 'You don’t own any cards to refund.', ephemeral: true });
    }

    // Map for quick ownership lookups
    const qtyByCode = new Map(itemsRows.map(r => [r.cardCode, r.quantity]));

    // 2) If caller passed explicit codes → only those (clamped to owned qty)
    const items = [];
    if (codesRaw) {
      const codes = codesRaw
        .split(',')
        .map(c => c.trim().toUpperCase())
        .filter(Boolean);

      // collapse duplicates: code -> count requested
      const want = {};
      for (const c of codes) want[c] = (want[c] || 0) + 1;

      const owned = Object.keys(want).filter(code => qtyByCode.has(code));
      if (!owned.length) {
        return interaction.reply({ content: 'You don’t own the specified codes.', ephemeral: true });
      }

      const docs = await Card.find({ cardCode: { $in: owned } }).lean();
      for (const card of docs) {
        const have = qtyByCode.get(card.cardCode) || 0;
        const ask  = want[card.cardCode] || 0;
        const qty = Math.min(have, ask);
        if (qty > 0) items.push({
          cardCode: card.cardCode,
          rarity: card.rarity,
          category: (card.category || '').toLowerCase(),
          qty
        });
      }
    } else {
      // 3) Otherwise: pull all owned codes, join to Card, apply filters accurately
      const ownedCodes = Array.from(qtyByCode.keys());
      const cards = await Card.find({ cardCode: { $in: ownedCodes } }).lean();

      for (const card of cards) {
        const qtyOwned = qtyByCode.get(card.cardCode) || 0;

        const g = (card.group || '').toLowerCase();
        const n = (card.name  || '').toLowerCase();
        const e = (card.era   || '').toLowerCase();

        const groupMatch = !group.length || group.includes(g);
        const nameMatch  = !name.length  || name.includes(n);
        const eraMatch   = !era.length   || era.includes(e);
        const notExName  = !excludeName.length || !excludeName.includes(n);
        const notExEra   = !excludeEra.length  || !excludeEra.includes(e);

        // rarity filter
        const rOk = (card.rarity >= minRarity && card.rarity <= maxRarity);

        // specials handling: if includeSpecials=false, skip ALL R5 up front (main & specials)
        if (card.rarity === 5 && !includeSpecials) continue;

        if (groupMatch && nameMatch && eraMatch && notExName && notExEra && rOk) {
          const qty = mode === 'dupes' ? Math.max(0, qtyOwned - 1) : qtyOwned;
          if (qty > 0) items.push({
            cardCode: card.cardCode,
            rarity: card.rarity,
            category: (card.category || '').toLowerCase(),
            qty
          });
        }
      }
    }

    if (!items.length) {
      return interaction.reply({ content: 'No cards match your filters to refund.', ephemeral: true });
    }

    // 4) Send preview + register session (the session will compute R5 payouts correctly and decrement inventory)
    const perPage = 10;
    const pages = Math.max(1, Math.ceil(items.length / perPage));
    const firstSlice = items.slice(0, perPage);

    const preview = new EmbedBuilder()
      .setTitle(`Refund Preview (${items.length} cards total)`)
      .setColor('#2f3136')
      .setDescription(firstSlice.map(e => `\`${e.cardCode}\` • R${e.rarity} ×${e.qty}`).join('\n') || '—')
      .setFooter({ text: `Page 1 of ${pages}` });

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary).setDisabled(true)
        .setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary).setDisabled(true)
        .setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary)
        .setDisabled(items.length <= perPage)
        .setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
      new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary)
        .setDisabled(items.length <= perPage)
        .setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' })
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('confirm_refund').setLabel('Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cancel_refund').setLabel('Cancel').setStyle(ButtonStyle.Danger)
    );

    const sent = await interaction.editReply({ embeds: [preview], components: [row1, row2] });
    registerRefundSession({
      message: sent,
      userId,
      items,                 // [{ cardCode, rarity, category, qty }]
      includeSpecials,       // boolean; session will pay R5 as 2500/3750 or skip if false
      perPage,
      refundValues: REFUND_VALUES
    });
  }
};
