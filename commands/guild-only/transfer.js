require('dotenv').config();
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const InventoryItem = require('../../models/InventoryItem');
const User = require('../../models/User');
const giveCurrency = require('../../utils/giveCurrency');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('transfer')
    .setDescription('Transfer ALL cards + currency from one user to another, then wipe the source.')
    .addUserOption(opt =>
      opt.setName('from').setDescription('User to transfer FROM').setRequired(true)
    )
    .addUserOption(opt =>
      opt.setName('to').setDescription('User to transfer TO').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('note').setDescription('Optional note to include in the result')
    )
    .setDefaultMemberPermissions('0'),

  async execute(interaction) {

    // Permission check
    if (!interaction.member.roles.cache.has(process.env.MAIN_BYPASS_ID)) {
      return safeReply(interaction, { content: 'You do not have permission to use this command.' });
    }

    const fromUser = interaction.options.getUser('from');
    const toUser = interaction.options.getUser('to');
    const note = interaction.options.getString('note') || '';

    if (fromUser.id === toUser.id) {
      return safeReply(interaction, { content: '`from` and `to` must be different users.' });
    }

    //
    // 1. LOAD SOURCE USER CURRENCY
    //
    const srcUserDoc = (await User.findOne({ userId: fromUser.id }).lean()) || {};
    const movePatterns = Number(srcUserDoc.patterns || 0);
    const moveSopop = Number(srcUserDoc.sopop || 0);

    //
    //
// 2. MOVE ALL CARDS USING InventoryItem WITH BULK OPS
//
let totalCodesMoved = 0;
let totalQtyMoved = 0;

try {
  // Load all source user's items
  const fromItems = await InventoryItem.find({ userId: fromUser.id });

  if (fromItems.length > 0) {
    const bulkOps = [];

    for (const item of fromItems) {
      const { cardCode, quantity } = item;
      if (!quantity || quantity <= 0) continue;

      totalCodesMoved += 1;
      totalQtyMoved += quantity;

      // 1) Increase TO user's quantity (upsert)
      bulkOps.push({
        updateOne: {
          filter: { userId: toUser.id, cardCode },
          update: { $inc: { quantity } },
          upsert: true
        }
      });

      // 2) Zero out FROM user's quantity
      bulkOps.push({
        updateOne: {
          filter: { userId: fromUser.id, cardCode },
          update: { $set: { quantity: 0 } }
        }
      });
    }

    // Execute ALL operations in a single MongoDB call
    if (bulkOps.length > 0) {
      await InventoryItem.bulkWrite(bulkOps);
    }
  }
} catch (err) {
  console.error('[transfer] Inventory bulk move failed:', err);
  return safeReply(interaction, {
    content: 'Card transfer failed. No changes were made to cards or currency.'
  });
}


    //
    // 3. CURRENCY TRANSFER (your existing logic)
    //
    let currencySummary = [];
    try {
      if (movePatterns > 0 || moveSopop > 0) {
        // Add to target
        await giveCurrency(toUser.id, {
          patterns: movePatterns,
          sopop: moveSopop
        });

        try {
          // Subtract from source
          await giveCurrency(fromUser.id, {
            patterns: -movePatterns,
            sopop: -moveSopop
          });
        } catch (subErr) {
          // Compensation rollback
          try {
            await giveCurrency(toUser.id, {
              patterns: -movePatterns,
              sopop: -moveSopop
            });
          } catch (compErr) {
            console.error('[transfer] currency compensation failed:', compErr);
          }
          console.error('[transfer] subtract error:', subErr);
          return safeReply(interaction, {
            content: 'Cards moved, but currency transfer failed and was rolled back.'
          });
        }

        if (movePatterns > 0) currencySummary.push(`• <:ehx_patterns:1389584144895315978> **${movePatterns}** Patterns`);
        if (moveSopop > 0) currencySummary.push(`• <:ehx_sopop:1389584273337618542> **${moveSopop}** Sopop`);
      }
    } catch (err) {
      console.error('[transfer] adding currency failed:', err);
      return safeReply(interaction, { content: 'Cards moved, but currency could not be transferred.' });
    }

    //
    // 4. CONFIRM EMBED
    //
    const embed = new EmbedBuilder()
      .setTitle('Transfer Complete')
      .setColor(0x3BA55D)
      .setDescription(
        [
          `From: **${fromUser.id}**`,
          `To: **${toUser.id}**`,
          note ? `Note: ${note}` : null
        ].filter(Boolean).join('\n')
      )
      .addFields(
        { name: 'Card codes moved', value: `${totalCodesMoved}`, inline: true },
        { name: 'Total quantity moved', value: `${totalQtyMoved}`, inline: true },
        { name: 'Currency moved', value: currencySummary.join('\n') || 'None', inline: false }
      )
      .setTimestamp();

    return safeReply(interaction, { embeds: [embed] });
  }
};
