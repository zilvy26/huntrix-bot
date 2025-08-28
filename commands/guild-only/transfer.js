require('dotenv').config();
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const UserInventory = require('../../models/UserInventory');
const User = require('../../models/User');
const giveCurrency = require('../../utils/giveCurrency');
const { safeReply } = require('../../utils/safeReply');

/**
 * Transfer ALL cards + currency from one user to another (merge/add),
 * then empty the source user's inventory and zero their currency.
 * No Mongo transactions are used (works on standalone / free-tier Atlas).
 *
 * Currency keys moved via giveCurrency: { patterns, sopop }.
 * - Step 1: add to target
 * - Step 2: subtract from source (negative inc)
 * If Step 2 fails, Step 1 is compensated (reversed) to avoid mismatch.
 */

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
    // Keep restricted; change/remove this line if you want broader access
    .setDefaultMemberPermissions('0'),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(process.env.MAIN_BYPASS_ID)) {
        return safeReply(interaction, { content: 'You do not have permission to use this command.' });
        }

    const fromUser = interaction.options.getUser('from');
    const toUser = interaction.options.getUser('to');
    const note = interaction.options.getString('note') || '';

    if (fromUser.id === toUser.id) {
      return safeReply(interaction, { content: '`from` and `to` must be different users.' });
    }

    // --- 1) Read source currency balances (defaults 0 if missing)
    const srcUserDoc = (await User.findOne({ userId: fromUser.id }).lean()) || {};
    const movePatterns = Number(srcUserDoc.patterns || 0);
    const moveSopop = Number(srcUserDoc.sopop || 0);

    // --- 2) Move CARDS (sequential saves, no transactions)
    let totalCodesMoved = 0;
    let totalQtyMoved = 0;

    try {
      const [fromInv, toInv] = await Promise.all([
        UserInventory.findOne({ userId: fromUser.id }),
        UserInventory.findOne({ userId: toUser.id })
      ]);
      // Build/ensure target doc
      let targetInv = toInv;
      if (!targetInv) {
        targetInv = new UserInventory({ userId: toUser.id, cards: [] });
      }

      // Merge cards from source -> target
      const tMap = new Map((targetInv.cards || []).map(c => [c.cardCode, Number(c.quantity) || 0]));

      for (const sc of (fromInv?.cards || [])) {
        const code = sc.cardCode;
        const qty = Number(sc.quantity) || 0;
        if (!code || qty <= 0) continue;
        totalCodesMoved += 1;
        totalQtyMoved += qty;
        tMap.set(code, (tMap.get(code) || 0) + qty);
      }

      // Persist target & wipe source cards
      targetInv.cards = Array.from(tMap, ([cardCode, quantity]) => ({ cardCode, quantity }));
      const writes = [targetInv.save()];
      if (fromInv) {
        fromInv.cards = [];
        writes.push(fromInv.save());
      }
      await Promise.all(writes);
    } catch (err) {
      console.error('[transfer] card move failed:', err);
      return safeReply(interaction, {
        content: 'Card transfer failed. No changes were made to cards or currency.'
      });
    }

    // --- 3) Move CURRENCY via your giveCurrency util (with compensation)
    let currencySummary = [];
    try {
      if (movePatterns > 0 || moveSopop > 0) {
        // Add to target first
        await giveCurrency(toUser.id, {
          patterns: movePatterns,
          sopop: moveSopop
        });

        try {
          // Subtract from source by adding negatives
          await giveCurrency(fromUser.id, {
            patterns: -movePatterns,
            sopop: -moveSopop
          });
        } catch (subErr) {
          // Compensation: undo the add to target if the subtraction fails
          try {
            await giveCurrency(toUser.id, {
              patterns: -movePatterns,
              sopop: -moveSopop
            });
          } catch (compErr) {
            console.error('[transfer] currency compensation failed:', compErr);
          }
          console.error('[transfer] subtracting currency from source failed:', subErr);
          return safeReply(interaction, {
            content:
              'Cards moved, but currency transfer failed and was rolled back. Source balances unchanged.'
          });
        }

        if (movePatterns > 0) currencySummary.push(`• <:ehx_patterns:1389584144895315978> **${movePatterns}** Patterns`);
        if (moveSopop > 0) currencySummary.push(`• <:ehx_sopop:1389584273337618542> **${moveSopop}** Sopop`);
      }
    } catch (addErr) {
      console.error('[transfer] adding currency to target failed:', addErr);
      return safeReply(interaction, {
        content: 'Cards moved successfully, but currency could not be transferred.'
      });
    }

    // --- 4) Confirmation embed
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