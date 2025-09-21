// commands/global/tradecard.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const Card = require('../../models/Card');
const InventoryItem = require('../../models/InventoryItem'); // ✅ new (replaces UserInventory)
const UserRecord = require('../../models/UserRecord');
const generateStars = require('../../utils/starGenerator');
const awaitUserButton = require('../../utils/awaitUserButton');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tradecard')
    .setDescription('Gift one or more cards to another user')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The user to trade cards to')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('cardcodes')
        .setDescription('Comma-separated card codes like CODE1+2, CODE2')
        .setRequired(true)
    ),

  async execute(interaction) {
    const giver = interaction.user;
    const receiver = interaction.options.getUser('user');
    const rawCodes = interaction.options.getString('cardcodes');

    if (receiver.bot || giver.id === receiver.id) {
      return safeReply(interaction, { content: 'You cannot trade cards to yourself or bots.' });
    }

    // Parse "CODE" or "CODE+N"
    const counts = {};
    const inputCodes = rawCodes.trim().split(/[\s,]+/);
    for (const token of inputCodes) {
      const m = token.match(/^(.+?)(?:\+(\d+))?$/i);
      if (!m) continue;
      const cardCode = m[1].toUpperCase().trim();
      const qty = m[2] ? parseInt(m[2], 10) : 1;
      if (!cardCode || isNaN(qty) || qty <= 0) continue;
      counts[cardCode] = (counts[cardCode] || 0) + qty;
    }

    const uniqueCodes = Object.keys(counts);
    if (!uniqueCodes.length) {
      return safeReply(interaction, { content: 'No valid card codes were provided.' });
    }

    // Validate codes exist
    const cards = await Card.find({ cardCode: { $in: uniqueCodes } }).lean();
    const foundCodes = new Set(cards.map(c => c.cardCode));
    const missing = uniqueCodes.filter(code => !foundCodes.has(code));
    if (missing.length) {
      return safeReply(interaction, { content: `These codes are invalid or not found: ${missing.join(', ')}` });
    }

    // Load giver quantities for the requested codes
    const giverRows = await InventoryItem.find(
      { userId: giver.id, cardCode: { $in: uniqueCodes } },
      { cardCode: 1, quantity: 1, _id: 0 }
    ).lean();
    const giverQtyMap = Object.fromEntries(giverRows.map(r => [r.cardCode, r.quantity]));

    const traded = [];
    let totalSouls = 0;
    let totalCards = 0;

    // Process each requested card code
    for (const card of cards) {
      const need = counts[card.cardCode];
      const have = giverQtyMap[card.cardCode] || 0;
      if (have < need) {
        // skip; not enough copies to give
        continue;
      }

      // 1) Decrement giver with guard (won't go negative)
      const dec = await InventoryItem.findOneAndUpdate(
        { userId: giver.id, cardCode: card.cardCode, quantity: { $gte: need } },
        { $inc: { quantity: -need } },
        { new: true, projection: { quantity: 1 } }
      );
      if (!dec) {
        // Another concurrent action may have consumed copies—skip this one
        continue;
      }
      if ((dec.quantity ?? 0) <= 0) {
        await InventoryItem.deleteOne({ userId: giver.id, cardCode: card.cardCode });
      }

      // 2) Increment receiver (upsert)
      const inc = await InventoryItem.findOneAndUpdate(
        { userId: receiver.id, cardCode: card.cardCode },
        { $setOnInsert: { userId: receiver.id, cardCode: card.cardCode }, $inc: { quantity: need } },
        { upsert: true, new: true, projection: { quantity: 1, _id: 0 } }
      );
      const newQty = inc?.quantity ?? need;

      // 3) Audit logs (one per copy to match your old behavior)
      for (let i = 0; i < need; i++) {
        await UserRecord.create({
          userId: receiver.id,
          type: 'tradecard',
          targetId: giver.id,
          detail: `Received ${card.name} (${card.cardCode}) [${card.rarity}] from <@${giver.id}>`
        });
        await UserRecord.create({
          userId: giver.id,
          type: 'tradecard',
          targetId: receiver.id,
          detail: `Gave ${card.name} (${card.cardCode}) [${card.rarity}] to <@${receiver.id}>`
        });
      }

      traded.push({ card, qty: need, total: newQty });
      totalSouls += card.rarity * need;
      totalCards += need;
    }

    if (!traded.length) {
      return safeReply(interaction, { content: 'No cards were successfully traded (not enough copies?).' });
    }

    // Pagination
    const perPage = 5;
    const pages = Math.ceil(traded.length / perPage);
    let current = 0;

    const renderEmbed = (page) => {
      const items = traded.slice(page * perPage, (page + 1) * perPage);
      return new EmbedBuilder()
        .setTitle(`Cards Gifted to ${receiver.username}`)
        .setColor('#2f3136')
        .setDescription(items.map(t =>
          `${generateStars({ rarity: t.card.rarity, overrideEmoji: t.card.emoji })} \`${t.card.cardCode}\` — **x${t.qty}** [Copies: ${t.total}]`
        ).join('\n'))
        .addFields(
          { name: 'Total Cards', value: `${totalCards}`, inline: true },
          { name: 'Total <:fullstar:1387609456824680528>', value: `${totalSouls}`, inline: true }
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

    // 1) Send the embed page
    await safeReply(interaction, {
      embeds: [renderEmbed(current)],
      components: [renderRow()]
    });

    // 2) Ping the receiver (separate msg so it hits Mentions)
    await interaction.followUp({
      content: `Card trade sent to <@${receiver.id}>!`,
      allowedMentions: { users: [receiver.id] }
    });

    // Pagination loop
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
