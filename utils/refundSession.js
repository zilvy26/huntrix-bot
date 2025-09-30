// utils/refundSession.js
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const sessions = new Map();
// auto-clean
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (s.expiresAt <= now) sessions.delete(k);
}, 10 * 60 * 1000).unref();

function makeEmbed(state) {
  const { items, page, perPage } = state;
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const start = page * perPage;
  const slice = items.slice(start, start + perPage);

  return new EmbedBuilder()
    .setTitle(`Refund Preview (${items.length} cards total)`)
    .setColor('#2f3136')
    .setDescription(
      slice.map(e => `\`${e.cardCode}\` • R${e.rarity} ×${e.qty}`).join('\n') || '—'
    )
    .setFooter({ text: `Page ${page + 1} of ${pages}` });
}

function makeButtons(state) {
  const { items, page, perPage } = state;
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0)
        .setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary)
        .setDisabled(page === 0)
        .setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary)
        .setDisabled(page >= pages - 1)
        .setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
      new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pages - 1)
        .setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' })
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('confirm_refund').setLabel('Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cancel_refund').setLabel('Cancel').setStyle(ButtonStyle.Danger)
    )
  ];
}

/** Called by /refund after sending the preview */
function registerRefundSession({ message, userId, items, includeSpecials, perPage = 10 }) {
  sessions.set(message.id, {
    ownerId: userId,
    messageId: message.id,
    channelId: message.channelId,
    items,                // [{ cardCode, rarity, category, qty }]
    includeSpecials,      // boolean
    page: 0,
    perPage,
    expiresAt: Date.now() + 30 * 60 * 1000
  });
}

/** Router helper: handle generic buttons for refund; returns true if handled */
// utils/refundSession.js  (only the handler body shown)
// ...snip...
async function handleRefundButtons(interaction, { Card, User, InventoryItem, REFUND_VALUES }) {
  if (!interaction.isButton?.()) return false;

  const msgId = interaction.message?.id;
  if (!msgId || !sessions.has(msgId)) return false; // not a refund session

  const state = sessions.get(msgId);
  if (interaction.user.id !== state.ownerId) {
    await interaction.followUp({ content: 'Only the creator can use these buttons.', ephemeral: interaction.inGuild() });
    return true;
  }

  const id = interaction.customId;

  // NAV
  if (id === 'first' || id === 'prev' || id === 'next' || id === 'last') {
    const pages = Math.max(1, Math.ceil(state.items.length / state.perPage));
    if (id === 'first') state.page = 0;
    if (id === 'prev')  state.page = Math.max(0, state.page - 1);
    if (id === 'next')  state.page = Math.min(pages - 1, state.page + 1);
    if (id === 'last')  state.page = pages - 1;

    // ✅ Button -> use update(), not editReply()
    await interaction.editReply({ embeds: [makeEmbed(state)], components: makeButtons(state) });
    return true;
  }

  // CANCEL
  if (id === 'cancel_refund') {
    sessions.delete(msgId);
    // ✅ Button -> use update()
    await interaction.editReply({ content: 'Refund cancelled.', embeds: [], components: [] });
    return true;
  }

  // CONFIRM
  if (id === 'confirm_refund') {
    // 🔒 disable the UI immediately to acknowledge the click
    const disabledRows = interaction.message.components.map(row => {
      const r = ActionRowBuilder.from(row);
      r.components = r.components.map(c => ButtonBuilder.from(c).setDisabled(true));
      return r;
    });
    await interaction.editReply({ embeds: interaction.message.embeds, components: disabledRows });

    // --- compute + apply changes (unchanged from your code) ---
    const codes = state.items.map(i => i.cardCode);
    const cards = await Card.find({ cardCode: { $in: codes } }).lean();
    const byCode = new Map(cards.map(c => [c.cardCode, c]));

    let total = 0;
    const lines = [];

    for (const it of state.items) {
      const card = byCode.get(it.cardCode);
      if (!card) continue;

      const category = (card.category || '').toLowerCase();
      const isSpecial = card.rarity === 5 && ['event', 'zodiac', 'others'].includes(category);
      const isR5Main  = card.rarity === 5 && ['kpop', 'anime', 'game'].includes(category);

      let amount = 0;
      if (card.rarity === 5) {
        if (state.includeSpecials) {
          if (isSpecial) amount = 3750 * it.qty;
          else if (isR5Main) amount = 2500 * it.qty;
        } else {
          continue;
        }
      } else {
        amount = (REFUND_VALUES[card.rarity] || 0) * it.qty;
      }

      if (amount > 0) {
        total += amount;
        lines.push(`\`${card.cardCode}\` • R${card.rarity} ×${it.qty} → +${amount}`);

        const dec = await InventoryItem.findOneAndUpdate(
          { userId: state.ownerId, cardCode: card.cardCode, quantity: { $gte: it.qty } },
          { $inc: { quantity: -it.qty } },
          { new: true, projection: { quantity: 1 } }
        );
        if (dec && (dec.quantity ?? 0) <= 0) {
          await InventoryItem.deleteOne({ userId: state.ownerId, cardCode: card.cardCode });
        }
      }
    }

    if (total > 0) {
      await User.updateOne({ userId: state.ownerId }, { $inc: { patterns: total } });
    }

    const result = new EmbedBuilder()
      .setTitle('Refund Complete')
      .setColor('#2f3136')
      .setDescription(`You received **${total} <:ehx_patterns:1389584144895315978>**`)
      .addFields({ name: 'Details', value: (lines.join('\n') || '—').slice(0, 1024) });

    sessions.delete(msgId);

    // ✅ after update(), edit the same message object
    await interaction.message.edit({ embeds: [result], components: [] });
    // (optional) also send an ephemeral confirmation
    // await interaction.followUp({ content: '✅ Refund completed.', ephemeral: true });

    return true;
  }

  return false;
}


module.exports = {
  registerRefundSession,
  handleRefundButtons,
  _sessions: sessions // optional for debugging
};
