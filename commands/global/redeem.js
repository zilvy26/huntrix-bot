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
    const userId = interaction.user.id;
    const codeInput = (interaction.options.getString('code') || '').trim().toUpperCase();
    const selectedCardInput = (interaction.options.getString('cardcode') || '').trim().toUpperCase() || null;

    const code = await RedeemCode.findOne({ code: codeInput });
    if (!code) return safeReply(interaction, { content: '❌ Invalid code.' });

    const now = new Date();
    if (code.expiresAt && code.expiresAt < now) {
      return safeReply(interaction, { content: '⚠️ This code has expired.' });
    }
    if (code.maxUses && code.usedBy.length >= code.maxUses) {
      return safeReply(interaction, { content: '⚠️ This code has reached its usage limit.' });
    }
    if (code.usedBy.includes(userId)) {
      return safeReply(interaction, { content: '⚠️ You already used this code.' });
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
    if (code.allowCardChoice) {
      if (!selectedCardInput) {
        return safeReply(interaction, {
          content: 'This code requires you to specify a card: `/redeem code:<code> cardcode:<yourCard>`.'
        });
      }

      // Only allow real, redeemable cards
      const validCard = await Card.findOne({
        cardCode: selectedCardInput,
        category: { $ne: 'others' }
      }).lean();

      if (!validCard) {
        return safeReply(interaction, { content: 'Invalid card code or not redeemable.' });
      }

      // 🔒 Hardcoded exclusions (case-insensitive)
const excludedCards = [];
const excludedGroups = [];
const excludedNames = [];
const excludedEras = ['PC25', 'How It\'s Done'];

if (
  excludedCards.includes(validCard.cardCode.toLowerCase()) ||
  excludedGroups.includes((validCard.group || '').toLowerCase()) ||
  excludedNames.includes((validCard.name || '').toLowerCase()) ||
  excludedEras.includes((validCard.era || '').toLowerCase())
) {
  return safeReply(interaction, { content: 'That card is not redeemable.' });
}

      // +1 copy to inventory (atomic)
      const updated = await InventoryItem.findOneAndUpdate(
        { userId, cardCode: selectedCardInput },
        { $setOnInsert: { userId, cardCode: selectedCardInput }, $inc: { quantity: 1 } },
        { upsert: true, new: true, projection: { quantity: 1, _id: 0 } }
      );

      // Mark usage and finish
      code.usedBy.push(userId);
      await code.save();

      const total = updated?.quantity ?? 1;
      return safeReply(interaction, {
        content: `Redeemed and received **${selectedCardInput}**! (Total copies: **${total}**)`
      });
    }

    // --- Track usage for non-choice codes
    code.usedBy.push(userId);
    await code.save();

    const summary = [
      `Redeemed **${code.code}**!`,
      code.reward?.patterns ? `• ${code.reward.patterns} Patterns` : null,
      code.reward?.sopop ? `• ${code.reward.sopop} Sopop` : null,
      code.cardCode ? `• Card Code: ${String(code.cardCode).trim().toUpperCase()}` : null
    ].filter(Boolean).join('\n');

    return safeReply(interaction, { content: summary || 'Redeemed successfully.' });
  }
};
