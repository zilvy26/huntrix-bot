// commands/global/grantcard.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const dotenv = require('dotenv');
dotenv.config();

const Card = require('../../models/Card');
// 🔁 NEW: per-item inventory
const InventoryItem = require('../../models/InventoryItem');
const UserRecord = require('../../models/UserRecord');
const generateStars = require('../../utils/starGenerator');
const awaitUserButton = require('../../utils/awaitUserButton');
const { safeReply } = require('../../utils/safeReply');

const GRANTING_ROLE_ID = process.env.GRANTING_ROLE_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grantcard')
    .setDescription('Grant one or more cards to a user by card code')
    .setDefaultMemberPermissions('0')
    .addUserOption(opt =>
      opt.setName('user').setDescription('User to receive the cards').setRequired(true))
    .addStringOption(opt =>
      opt.setName('cardcodes')
        .setDescription('Comma-separated card codes (e.g. CODE1+2, CODE2, CODE3+-2)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const sender = interaction.member;
    const targetUser = interaction.options.getUser('user');
    const rawCodes = interaction.options.getString('cardcodes');

    // --- Permission gate ---
    if (!sender?.roles?.cache?.has(GRANTING_ROLE_ID)) {
      return safeReply(interaction, { content: 'You lack permission to use this.' });
    }

    // --- Parse "CODE+N" (case-insensitive) → { codeLower: qty }
    const counts = {};
    const parts = rawCodes.split(',').map(c => c.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^(.+?)(?:\+(-?\d+))?$/i);
      if (!m) continue;
      const codeKey = m[1].toLowerCase();
      const qty = parseInt(m[2] ?? '1', 10);
      if (Number.isNaN(qty) || qty === 0) continue;
      counts[codeKey] = (counts[codeKey] || 0) + qty;
    }
    const uniqueLower = Object.keys(counts);
    if (!uniqueLower.length) {
      return safeReply(interaction, { content: 'No valid codes parsed.' });
    }

    // --- Fetch matching Cards (case-insensitive)
    const regexes = uniqueLower.map(c => new RegExp(`^${escapeRegex(c)}$`, 'i'));
    const cards = await Card.find({ cardCode: { $in: regexes } }).lean();

    if (!cards.length) {
      return safeReply(interaction, { content: 'No valid cards found for those codes.' });
    }

    // Map code → Card, and gather the canonical codes we touch
    const byCode = new Map(cards.map(c => [c.cardCode, c]));
    const canonCodes = cards.map(c => c.cardCode);

    // --- Load current InventoryItem rows for target user for those codes
    const currentRows = await InventoryItem.find(
      { userId: targetUser.id, cardCode: { $in: canonCodes } },
      { _id: 0, cardCode: 1, quantity: 1 }
    ).lean();
    const currentQty = Object.fromEntries(currentRows.map(r => [r.cardCode, r.quantity]));

    // --- Compute updates and audit list
    const ops = [];
    const granted = []; // { card, qty (requested), total (new total), applied (delta actually applied) }
    let totalSouls = 0;
    let totalCards = 0;

    for (const code of canonCodes) {
      const card = byCode.get(code);
      const req = counts[card.cardCode.toLowerCase()] || 0;   // requested change (+/-)
      if (req === 0) continue;

      const cur = currentQty[code] || 0;
      let newQty = cur + req;
      if (newQty < 0) newQty = 0;                              // clamp like your original
      const applied = newQty - cur;                            // what will actually happen

      // Build write op
      if (newQty === 0) {
        if (cur > 0) {
          // set to zero → delete row to keep collection lean
          ops.push({ deleteOne: { filter: { userId: targetUser.id, cardCode: code } } });
        }
      } else if (cur === 0) {
        // create or set exact quantity
        ops.push({
          updateOne: {
            filter: { userId: targetUser.id, cardCode: code },
            update: { $setOnInsert: { userId: targetUser.id, cardCode: code }, $set: { quantity: newQty } },
            upsert: true
          }
        });
      } else {
        // update existing to exact newQty
        ops.push({
          updateOne: {
            filter: { userId: targetUser.id, cardCode: code },
            update: { $set: { quantity: newQty } }
          }
        });
      }

      // Tally + audit prep
      granted.push({ card, qty: req, total: newQty, applied });
      totalCards += req;
      totalSouls += (card.rarity || 0) * req;
    }

    // Nothing to do?
    if (!ops.length) {
      return safeReply(interaction, { content: 'Nothing changed (maybe all requests net to 0?).' });
    }

    // --- Apply all changes
    await InventoryItem.bulkWrite(ops, { ordered: false });

    // --- Per-copy audit (use |applied| so we don’t over-log when clamped)
    for (const g of granted) {
      const copies = Math.abs(g.applied);
      if (!copies) continue;
      const actionType = g.applied > 0 ? 'Granted' : 'Removed';
      for (let i = 0; i < copies; i++) {
        await UserRecord.create({
          userId: targetUser.id,
          type: 'grantcard',
          targetId: interaction.user.id,
          detail: `${actionType} ${g.card.name} (${g.card.cardCode}) [${g.card.rarity}] by <@${interaction.user.id}>`
        });
      }
    }

    // --- (Optional) Re-read to display confirmed totals (already have new totals in granted.total)

    // --- Paged results embed (same style)
    const perPage = 5;
    const pages = Math.max(1, Math.ceil(granted.length / perPage));
    let current = 0;

    const renderEmbed = (page) => {
      const slice = granted.slice(page * perPage, (page + 1) * perPage);
      const desc = slice.map(g =>
        `• ${generateStars({ rarity: g.card.rarity, overrideEmoji: g.card.emoji })} \`${g.card.cardCode}\` — **${g.qty > 0 ? '+' : ''}${g.qty}** [Copies: ${g.total}]`
      ).join('\n') || 'No cards updated.';

      return new EmbedBuilder()
        .setTitle(`Cards Updated for ${targetUser.username}`)
        .setColor('#2f3136')
        .setDescription(desc)
        .addFields(
          { name: 'Total Cards', value: `${totalCards}`, inline: true },
          { name: 'Total <:fullstar:1387609456824680528>', value: `${totalSouls}`, inline: true }
        )
        .setFooter({ text: `Page ${page + 1} of ${pages}` });
    };

    const renderRow = () => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary).setDisabled(current === 0).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary).setDisabled(current === 0).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary).setDisabled(current >= pages - 1).setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
      new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
    );

    await safeReply(interaction, { embeds: [renderEmbed(current)], components: [renderRow()] });

    // --- Pagination loop (unchanged)
    while (true) {
      const btn = await awaitUserButton(interaction, interaction.user.id, ['first', 'prev', 'next', 'last'], 120000);
      if (!btn) break;

      if (!btn.deferred && !btn.replied) {
        try { await btn.deferUpdate(); } catch {}
      }

      if (btn.customId === 'first') current = 0;
      if (btn.customId === 'prev') current = Math.max(0, current - 1);
      if (btn.customId === 'next') current = Math.min(pages - 1, current + 1);
      if (btn.customId === 'last') current = pages - 1;

      await interaction.editReply({ embeds: [renderEmbed(current)], components: [renderRow()] });
    }

    // Cleanup
    try { await interaction.editReply({ components: [] }); } catch (err) {
      console.warn('Pagination cleanup failed:', err.message);
    }
  }
};

// util
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
