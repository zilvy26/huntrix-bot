const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const Card = require('../../models/Card');
const UserInventory = require('../../models/UserInventory');
const UserRecord = require('../../models/UserRecord');
const generateStars = require('../../utils/starGenerator');
const awaitUserButton = require('../../utils/awaitUserButton');
const {safeReply} = require('../../utils/safeReply');

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
        .setDescription('Comma-separated card codes like CODE1x2, CODE2')
        .setRequired(true)),

  async execute(interaction) {


    const giver = interaction.user;
    const receiver = interaction.options.getUser('user');
    const rawCodes = interaction.options.getString('cardcodes');

    if (receiver.bot || giver.id === receiver.id) {
      return safeReply(interaction, { content: 'You cannot trade cards to yourself or bots.' });
    }

    const counts = {};
const inputCodes = rawCodes.trim().split(/[\s,]+/); // however you split codes

for (const code of inputCodes) {
  const match = code.match(/^(.+?)(?:X(\d+))?$/i); // match "CODE" or "CODEX2"
  if (!match) continue;

  const cardCode = match[1].toUpperCase();
  const quantity = match[2] ? parseInt(match[2]) : 1;

  counts[cardCode] = (counts[cardCode] || 0) + quantity;
}



    const uniqueCodes = Object.keys(counts);
    const cards = await Card.find({ cardCode: { $in: uniqueCodes } });
    if (!cards.length || cards.length !== uniqueCodes.length) {
    const foundCodes = new Set(cards.map(c => c.cardCode));
    const missing = uniqueCodes.filter(code => !foundCodes.has(code));
  return safeReply(interaction, { content: `These codes are invalid or not found: ${missing.join(', ')}` });
    }

    const giverInv = await UserInventory.findOne({ userId: giver.id });
    if (!giverInv) return safeReply(interaction, { content: 'You have no cards to trade.' });
    


    let receiverInv = await UserInventory.findOne({ userId: receiver.id });
    if (!receiverInv) receiverInv = await UserInventory.create({ userId: receiver.id, cards: [] });

    const traded = [];
    let totalSouls = 0;
    let totalCards = 0;

    for (const card of cards) {
  const qty = counts[card.cardCode];
  const entry = giverInv.cards.find(c =>
    c.cardCode.toUpperCase().trim() === card.cardCode
  );
  

  if (!entry || entry.quantity < qty) {
    continue;
  }

      entry.quantity -= qty;
      if (entry.quantity === 0) {
        giverInv.cards = giverInv.cards.filter(c => c.cardCode !== card.cardCode);
      }

      const existing = receiverInv.cards.find(c => c.cardCode === card.cardCode);
      if (existing) existing.quantity += qty;
      else receiverInv.cards.push({ cardCode: card.cardCode, quantity: qty });
      const newQty = receiverInv.cards.find(c => c.cardCode === card.cardCode).quantity;

      traded.push({ card, qty, total: newQty });
      totalSouls += card.rarity * qty;
      totalCards += qty;

      for (let i = 0; i < qty; i++) {
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
    }

    await giverInv.save();
    await receiverInv.save();

    if (!traded.length) {
      return safeReply(interaction, { content: 'No cards were successfully traded.' });
    }

    // Pagination Setup
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
      new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary).setDisabled(current === 0).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary).setDisabled(current === 0).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary).setDisabled(current >= pages - 1).setEmoji({ id: '1390462706544410704', name: ':ehx_rightarrow' }),
      new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
    );

    // 1. Send the embed page without a mention first
await safeReply(interaction, {
  embeds: [renderEmbed(current)],
  components: [renderRow()]
});

// 2. Immediately send the ping in a separate message to trigger Mentions tab
await interaction.followUp({
  content: `Card trade sent to <@${receiver.id}>!`,
  allowedMentions: { users: [receiver.id] }
});

    while (true) {
      const btn = await awaitUserButton(interaction, interaction.user.id, ['first', 'prev', 'next', 'last'], 120000);
      if (!btn) break;

      if (btn.customId === 'first') current = 0;
      if (btn.customId === 'prev') current = Math.max(0, current - 1);
      if (btn.customId === 'next') current = Math.min(pages - 1, current + 1);
      if (btn.customId === 'last') current = pages - 1;

      await safeReply(interaction, { embeds: [renderEmbed(current)], components: [renderRow()] });
    }

    // Final cleanup
    try {
      await safeReply(interaction, { components: [] });
    } catch (err) {
      console.warn('Pagination cleanup failed:', err.message);
    }
  }
};