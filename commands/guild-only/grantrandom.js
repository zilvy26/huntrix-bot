// commands/global/grantrandom.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const Card = require('../../models/Card');
const InventoryItem = require('../../models/InventoryItem'); // ✅ NEW
const UserRecord = require('../../models/UserRecord');
const generateStars = require('../../utils/starGenerator');
const awaitUserButton = require('../../utils/awaitUserButton');
const { safeReply } = require('../../utils/safeReply');

const GRANTING_ROLE_ID = process.env.GRANTING_ROLE_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grantrandom')
    .setDescription('Grant OR remove random cards with filters and limits (use negative amount to remove)')
    .setDefaultMemberPermissions('0')
    .addUserOption(o => o.setName('user').setDescription('Recipient').setRequired(true))
    .addIntegerOption(o =>
      o.setName('amount')
        .setDescription('Number of cards to grant (e.g. 5) or REMOVE (e.g. -5)')
        .setRequired(true)
    )
    .addStringOption(o => o.setName('groups').setDescription('Comma-separated group names'))
    .addStringOption(o => o.setName('names').setDescription('Comma-separated idol names'))
    .addStringOption(o => o.setName('eras').setDescription('Comma-separated eras'))
    .addStringOption(o => o.setName('rarities').setDescription('Rarity range, e.g. "2-5" or "3"'))
    .addIntegerOption(o => o.setName('maxstars').setDescription('Maximum total star value (optional)')),

  async execute(interaction) {
    // ----- permission
    const sender = interaction.member;
    if (!sender?.roles?.cache?.has(GRANTING_ROLE_ID)) {
      return safeReply(interaction, { content: '❌ You lack permission to use this.' });
    }

    const recipient = interaction.options.getUser('user');
    if (!recipient || recipient.bot) {
      return safeReply(interaction, '❌ Invalid recipient.');
    }

    // ----- inputs & helpers
    const amountRaw = interaction.options.getInteger('amount');
    if (!amountRaw || amountRaw === 0) {
      return safeReply(interaction, { content: 'Amount must be non-zero (positive to grant, negative to remove).' });
    }
    const isRemoval = amountRaw < 0;
    const amount = Math.abs(amountRaw);

    const parseCsv = (s) => (s || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
    const groups = parseCsv(interaction.options.getString('groups'));
    const names  = parseCsv(interaction.options.getString('names'));
    const eras   = parseCsv(interaction.options.getString('eras'));

    const rarityRange = (interaction.options.getString('rarities') || '').trim();
    let minR = 1, maxR = 5;
    if (rarityRange) {
      const mRange = rarityRange.match(/^(\d+)\s*-\s*(\d+)$/);
      const mSingle = rarityRange.match(/^(\d+)$/);
      if (mRange) {
        minR = Math.max(1, Math.min(5, +mRange[1]));
        maxR = Math.max(1, Math.min(5, +mRange[2]));
        if (minR > maxR) [minR, maxR] = [maxR, minR];
      } else if (mSingle) {
        minR = maxR = Math.max(1, Math.min(5, +mSingle[1]));
      } else {
        return safeReply(interaction, { content: 'Invalid rarities format. Use "3" or "2-5".' });
      }
    }

    const maxStars = interaction.options.getInteger('maxstars') ?? Infinity;

    // ----- build pool
    // Always start from Card set, then for removals, intersect with owned.
    const cardQuery = { rarity: { $gte: minR, $lte: maxR } };
    const allCards = await Card.find(cardQuery).lean();

    const filtered = allCards.filter(c => {
      const g = (c.group || '').toLowerCase();
      const n = (c.name  || '').toLowerCase();
      const e = (c.era   || '').toLowerCase();
      if (groups.length && !groups.includes(g)) return false;
      if (names.length  && !names.includes(n))  return false;
      if (eras.length   && !eras.includes(e))   return false;
      return true;
    });

    if (!filtered.length) {
      return safeReply(interaction, 'No cards match those filters.');
    }

    // For removal, restrict to what the user actually owns
    let pool = filtered;
    let ownedMap = new Map(); // code -> quantity (only for removal)
    if (isRemoval) {
      const codes = filtered.map(c => c.cardCode);
      const rows = await InventoryItem.find(
        { userId: recipient.id, cardCode: { $in: codes } },
        { cardCode: 1, quantity: 1, _id: 0 }
      ).lean();
      ownedMap = new Map(rows.map(r => [r.cardCode, r.quantity]));
      pool = filtered.filter(c => (ownedMap.get(c.cardCode) || 0) > 0);
      if (!pool.length) return safeReply(interaction, 'User does not own any cards matching those filters.');
    }

    // ----- random picks (respect maxStars)
    // We’ll allow duplicates of the same code in the picks if the pool includes them.
    const picks = [];
    let starsSoFar = 0;

    // helper to pick one random card from pool that still fits maxStars
    const tryPick = () => {
      // Shuffle attempt slots a bit to avoid infinite loops when near maxStars
      for (let i = 0; i < pool.length; i++) {
        const c = pool[Math.floor(Math.random() * pool.length)];
        if (starsSoFar + (c.rarity || 0) > maxStars) continue;
        if (isRemoval) {
          const have = ownedMap.get(c.cardCode) || 0;
          if (have <= 0) continue; // can’t remove if they’re out
          ownedMap.set(c.cardCode, have - 1); // tentatively reserve one for removal
        }
        starsSoFar += (c.rarity || 0);
        picks.push(c);
        return true;
      }
      return false;
    };

    for (let i = 0; i < amount; i++) {
      if (!tryPick()) break;
    }

    if (!picks.length) {
      return safeReply(interaction, 'No cards could be selected under the star/amount limits.');
    }

    // ----- collapse picks by code → counts
    const counts = {};
    for (const c of picks) {
      counts[c.cardCode] = (counts[c.cardCode] || 0) + 1;
    }

    // ----- apply inventory changes
    const ops = [];
    const results = []; // { card, qty: +/-n, total: newTotal }
    let totalCards = 0;
    let totalSouls = 0;

    if (!isRemoval) {
      // GRANT: upsert + $inc
      for (const [code, qty] of Object.entries(counts)) {
        ops.push({
          updateOne: {
            filter: { userId: recipient.id, cardCode: code },
            update: {
              $setOnInsert: { userId: recipient.id, cardCode: code },
              $inc: { quantity: qty }
            },
            upsert: true
          }
        });
      }
      if (ops.length) await InventoryItem.bulkWrite(ops, { ordered: false });

      // read back for totals shown
      const updated = await InventoryItem.find(
        { userId: recipient.id, cardCode: { $in: Object.keys(counts) } },
        { cardCode: 1, quantity: 1, _id: 0 }
      ).lean();
      const qtyMap = Object.fromEntries(updated.map(d => [d.cardCode, d.quantity]));

      for (const [code, qty] of Object.entries(counts)) {
        const card = filtered.find(c => c.cardCode === code);
        results.push({ card, qty: +qty, total: qtyMap[code] || qty });
        totalCards += qty;
        totalSouls += qty * (card?.rarity || 0);
      }

      // per-copy audit
      for (const r of results) {
        for (let i = 0; i < r.qty; i++) {
          await UserRecord.create({
            userId: recipient.id,
            type: 'grantrandom',
            targetId: interaction.user.id,
            detail: `Granted random ${r.card.name} (${r.card.cardCode}) [${r.card.rarity}] by <@${interaction.user.id}>`
          });
        }
      }
    } else {
      // REMOVE: decrement with guard, prune zeros, one code at a time
      for (const [code, qty] of Object.entries(counts)) {
        // dec with guard
        const dec = await InventoryItem.findOneAndUpdate(
          { userId: recipient.id, cardCode: code, quantity: { $gte: qty } },
          { $inc: { quantity: -qty } },
          { new: true, projection: { quantity: 1 } }
        );
        if (!dec) continue; // skip if somehow not enough copies (race)
        if ((dec.quantity ?? 0) <= 0) {
          await InventoryItem.deleteOne({ userId: recipient.id, cardCode: code });
        }
        const card = filtered.find(c => c.cardCode === code);
        const newTotal = Math.max(0, dec.quantity ?? 0);
        results.push({ card, qty: -qty, total: newTotal });
        totalCards -= qty;
        totalSouls -= qty * (card?.rarity || 0);

        // per-copy audit
        for (let i = 0; i < qty; i++) {
          await UserRecord.create({
            userId: recipient.id,
            type: 'grantrandom',
            targetId: interaction.user.id,
            detail: `Removed random ${card.name} (${card.cardCode}) [${card.rarity}] by <@${interaction.user.id}>`
          });
        }
      }

      if (!results.length) {
        return safeReply(interaction, 'No cards were removed (insufficient copies?).');
      }
    }

    // ----- group same codes for display (combine qty and total)
    const grouped = {};
    for (const r of results) {
      const code = r.card.cardCode;
      if (!grouped[code]) grouped[code] = { ...r };
      else {
        grouped[code].qty += r.qty;
        grouped[code].total = Math.max(0, grouped[code].total + r.qty); // best-effort running total
      }
    }
    const groupedItems = Object.values(grouped);

    // ----- pagination
    const perPage = 5;
    const pages = Math.max(1, Math.ceil(groupedItems.length / perPage));
    let current = 0;

    const renderEmbed = (page) => {
      const slice = groupedItems.slice(page * perPage, (page + 1) * perPage);
      const desc = slice.map(g =>
        `• ${generateStars({ rarity: g.card.rarity, overrideEmoji: g.card.emoji })} \`${g.card.cardCode}\` — **${g.qty > 0 ? '+' : ''}${g.qty}** [Copies: ${g.total}]`
      ).join('\n') || (isRemoval ? 'No cards removed.' : 'No cards granted.');

      return new EmbedBuilder()
        .setTitle(`${isRemoval ? 'Random Cards Removed from' : 'Random Cards Given to'} ${recipient.username}`)
        .setColor('#2f3136')
        .setDescription(desc)
        .addFields(
          { name: 'Total Cards', value: `${Math.abs(totalCards)}`, inline: true },
          { name: 'Total <:fullstar:1387609456824680528>', value: `${Math.abs(totalSouls)}`, inline: true }
        )
        .setFooter({ text: `Page ${page + 1} of ${pages}` });
    };

    const renderRow = () => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary).setDisabled(current === 0)
        .setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary).setDisabled(current === 0)
        .setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary).setDisabled(current >= pages - 1)
        .setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
      new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1)
        .setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
    );

    await safeReply(interaction, { embeds: [renderEmbed(current)], components: [renderRow()] });

    // pagination loop
    while (true) {
      const btn = await awaitUserButton(interaction, interaction.user.id, ['first', 'prev', 'next', 'last'], 120000);
      if (!btn) break;
      if (!btn.deferred && !btn.replied) {
        try { await btn.deferUpdate(); } catch {}
      }
      if (btn.customId === 'first') current = 0;
      else if (btn.customId === 'prev') current = Math.max(0, current - 1);
      else if (btn.customId === 'next') current = Math.min(pages - 1, current + 1);
      else if (btn.customId === 'last') current = pages - 1;

      await interaction.editReply({ embeds: [renderEmbed(current)], components: [renderRow()] });
    }

    // cleanup
    try { await interaction.editReply({ components: [] }); } catch (err) {
      console.warn('Pagination cleanup failed:', err.message);
    }
  }
};
