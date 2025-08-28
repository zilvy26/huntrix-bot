require('dotenv').config();
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const mongoose = require('mongoose');
const UserInventory = require('../../models/UserInventory');
const User = require('../../models/User');
const giveCurrency = require('../../utils/giveCurrency');
const { safeReply } = require('../../utils/safeReply');

/**
 * This version:
 * - Adds all cards from source to target, then clears source's cards (transactional).
 * - Moves currency using the same util you use elsewhere: giveCurrency(userId, { patterns, sopop }).
 *   We add to target, then decrement source with negative values.
 *   If the second step fails, we compensate by subtracting back from target.
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
    // Require ManageGuild by default so only admins/mods can run this
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

    // 1) Read source currency balances (defaults to 0 if missing)
    const srcUserDoc =
      (await User.findOne({ userId: fromUser.id }).lean()) || { patterns: 0, sopop: 0 };
    const movePatterns = Number(srcUserDoc.patterns || 0);
    const moveSopop = Number(srcUserDoc.sopop || 0);

    // 2) Start transaction for CARDS
    const session = await mongoose.startSession();
    session.startTransaction();

    let totalCodesMoved = 0;
    let totalQtyMoved = 0;

    try {
      // Load inventories
      const [fromInv, toInv] = await Promise.all([
        UserInventory.findOne({ userId: fromUser.id }).session(session),
        UserInventory.findOne({ userId: toUser.id }).session(session)
      ]);

      if (!fromInv || !Array.isArray(fromInv.cards) || fromInv.cards.length === 0) {
        // Still move currency even if there are no cards
        // (don’t early return; we’ll just treat cards part as empty)
      }

      // Ensure target exists
      let targetInv = toInv;
      if (!targetInv) {
        targetInv = new UserInventory({ userId: toUser.id, cards: [] });
        targetInv.$session(session);
      }

      // Merge cards: map target, add quantities from source
      const tMap = new Map((targetInv.cards || []).map(c => [c.cardCode, Number(c.quantity) || 0]));
      for (const sc of (fromInv?.cards || [])) {
        const code = sc.cardCode;
        const qty = Number(sc.quantity) || 0;
        if (!code || qty <= 0) continue;
        totalCodesMoved += 1;
        totalQtyMoved += qty;
        tMap.set(code, (tMap.get(code) || 0) + qty);
      }

      // Persist new target list
      targetInv.cards = Array.from(tMap, ([cardCode, quantity]) => ({ cardCode, quantity }));

      // Wipe source cards
      if (fromInv) fromInv.cards = [];

      // Save inventories
      await Promise.all([
        targetInv.save({ session }),
        fromInv ? fromInv.save({ session }) : Promise.resolve()
      ]);
      // Commit cards transaction
      await session.commitTransaction();
      session.endSession();
    } catch (err) {
      try { await session.abortTransaction(); } catch {}
      session.endSession();
      console.error('[transfer] cards transfer failed:', err);
      return safeReply(interaction, {
        content: '❗ Card transfer failed. No changes were made to cards or currency.'
      });
    }

    // 3) Move currency using your giveCurrency util (non-transactional but with compensation)
    let currencySummary = [];
    try {
      // nothing to move? still show success with cards moved
      if (movePatterns > 0 || moveSopop > 0) {
        // Add to target
        await giveCurrency(toUser.id, {
          patterns: movePatterns,
          sopop: moveSopop
        });

        try {
          // Subtract from source (negative inc to zero it out)
          await giveCurrency(fromUser.id, {
            patterns: -movePatterns,
            sopop: -moveSopop
          });
        } catch (subErr) {
          // Compensation: undo the add if subtraction fails
          try {
            await giveCurrency(toUser.id, {
              patterns: -movePatterns,
              sopop: -moveSopop
            });
          } catch (compErr) {
            console.error('[transfer] compensation failed:', compErr);
          }
          console.error('[transfer] subtracting currency from source failed:', subErr);
          return safeReply(interaction, {
            content:
              '⚠️ Cards moved, but currency transfer failed and was rolled back. Source balances unchanged.'
          });
        }

        if (movePatterns > 0) currencySummary.push(`• <:ehx_patterns:1389584144895315978> **${movePatterns}** Patterns`);
        if (moveSopop > 0) currencySummary.push(`• <:ehx_sopop:1389584273337618542> **${moveSopop}** Sopop`);
      }
    } catch (addErr) {
      console.error('[transfer] adding currency to target failed:', addErr);
      // Currency add failed—cards already moved, but balances unchanged
      return safeReply(interaction, {
        content:
          '⚠️ Cards moved successfully, but currency could not be transferred (target add failed).'
      });
    }

    // 4) Confirmation embed
    const embed = new EmbedBuilder()
      .setTitle('✅ Transfer Complete')
      .setColor(0x3BA55D)
      .setDescription(
        [
          `From: **${fromUser.tag}**`,
          `To: **${toUser.tag}**`,
          note ? `Note: ${note}` : null
        ].filter(Boolean).join('\n')
      )
      .addFields(
        { name: 'Card codes moved', value: `${totalCodesMoved}`, inline: true },
        { name: 'Total quantity moved', value: `${totalQtyMoved}`, inline: true },
        {
          name: 'Currency moved',
          value: currencySummary.length ? currencySummary.join('\n') : 'None',
          inline: false
        }
      )
      .setTimestamp();

    return safeReply(interaction, { embeds: [embed] });
  }
};