// commands/global/redeem.js
const { SlashCommandBuilder } = require('discord.js');
const RedeemCode = require('../../models/RedeemCode');
const Card = require('../../models/Card');
const User = require('../../models/User');
// ⬇️ NEW: per-item inventory
const InventoryItem = require('../../models/InventoryItem');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Redeem a code for rewards!')
    .addStringOption(opt =>
      opt.setName('code')
        .setDescription('Your redeem code')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('cardcode')
        .setDescription('(Optional) Choose a card code if allowed')),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const userId = interaction.user.id;
    const codeInput = (interaction.options.getString('code') || '').trim().toUpperCase();
    const selectedCardInput = (interaction.options.getString('cardcode') || '').trim().toUpperCase() || null;

    const code = await RedeemCode.findOne({ code: codeInput });
    if (!code) return safeReply(interaction, { content: 'Invalid code.' });

    const now = new Date();
    if (code.expiresAt && code.expiresAt < now) {
      return interaction.followUp({ content: 'This code has expired.', flags: 1 << 6 }).catch(()=>{});
    }
    if (code.maxUses && code.usedBy.length >= code.maxUses) {
      return interaction.followUp({ content: 'This code has reached its usage limit.', flags: 1 << 6 }).catch(()=>{});
    }
    if (code.usedBy.includes(userId)) {
      return interaction.followUp({ content: 'You already used this code.', flags: 1 << 6 }).catch(()=>{});
    }

    // --- Currency rewards (unchanged)
    if (code.reward && (code.reward.patterns || code.reward.sopop)) {
      await User.findOneAndUpdate(
        { userId },
        {
          $inc: {
            patterns: code.reward.patterns || 0,
            sopop: code.reward.sopop || 0
          }
        },
        { upsert: true }
      );
    }

    // --- Static single-card reward (NEW: InventoryItem upsert +1)
    if (code.cardCode) {
      const cardCode = String(code.cardCode).trim().toUpperCase();
      await InventoryItem.findOneAndUpdate(
        { userId, cardCode },
        { $setOnInsert: { userId, cardCode }, $inc: { quantity: 1 } },
        { upsert: true, new: false }
      );
    }

    // --- Manual card choice path (NEW: InventoryItem upsert +1)
    // --- Manual card choice path (InventoryItem + hardcoded exclusions) ---
if (code.allowCardChoice) {
  if (!selectedCardInput) {
    return safeReply(interaction, {
      content: 'This code requires a card choice: `/redeem code:<code> cardcode:<yourCard>`.'
    });
  }

  // 1) Load the requested card (must be redeemable)
  const validCard = await Card.findOne({
    cardCode: selectedCardInput,     // you already uppercased input above
    category: { $ne: 'others' }
  }).lean();

  if (!validCard) {
    return safeReply(interaction, { content: 'Invalid card code or not redeemable.' });
  }

  // 2) 🔒 Hardcoded exclusions (edit these lists as needed)
  const EXCLUDED = {
    cards:  [],
    groups: [],
    names:  [],
    eras:   ['PC25', 'How It\'s Done']
  };

  // normalize lists to lowercase for case-insensitive comparison
  const ex = {
    cards:  EXCLUDED.cards.map(s => s.toLowerCase().trim()),
    groups: EXCLUDED.groups.map(s => s.toLowerCase().trim()),
    names:  EXCLUDED.names.map(s => s.toLowerCase().trim()),
    eras:   EXCLUDED.eras.map(s => s.toLowerCase().trim())
  };

  // normalize card fields
  const cardLC   = (validCard.cardCode || '').toLowerCase().trim();
  const groupLC  = (validCard.group    || '').toLowerCase().trim();
  const nameLC   = (validCard.name     || '').toLowerCase().trim();
  const eraLC    = (validCard.era      || '').toLowerCase().trim();

  // 3) Check exclusions BEFORE marking code used or changing inventory
  if (ex.cards.includes(cardLC) ||
      ex.groups.includes(groupLC) ||
      ex.names.includes(nameLC) ||
      ex.eras.includes(eraLC)) {
    return safeReply(interaction, { content: 'That card is excluded from this code.' });
  }

  // 4) Grant + mark usage (only if it passed exclusions)
  const updated = await InventoryItem.findOneAndUpdate(
    { userId, cardCode: selectedCardInput },
    { $setOnInsert: { userId, cardCode: selectedCardInput }, $inc: { quantity: 1 } },
    { upsert: true, new: true, projection: { quantity: 1, _id: 0 } }
  );

  code.usedBy.push(userId);
  await code.save();

  const total = updated?.quantity ?? 1;
  return safeReply(interaction, {
    content: `Redeemed and received **${selectedCardInput}**! (Total copies: **${total}**)`
  });
}

    const summary = [
      `Redeemed **${code.code}**!`,
      code.reward?.patterns ? `• ${code.reward.patterns} Patterns` : null,
      code.reward?.sopop ? `• ${code.reward.sopop} Sopop` : null,
      code.cardCode ? `• Card Code: ${String(code.cardCode).trim().toUpperCase()}` : null
    ].filter(Boolean).join('\n');

    return interaction.followUp({ content: summary || 'Redeemed successfully.', flags: 1 << 6 }).catch(()=>{});
  }
};
