// router/interactionRouter.js
require('dotenv').config();
const User = require('../models/User');
const Question = require('../models/Question');
const mongoose = require('mongoose');
const {
  AttachmentBuilder,
  ComponentType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');
const RecommendSettings   = require('../models/RecommendSettings');
const RecommendSubmission = require('../models/RecommendSubmission');
const recommendCommand    = require('../commands/guild-only/recommend'); // exports .data and .execute
const { safeReply } = require('../utils/safeReply');
const autoDefer = require('../utils/autoDefer'); // your helper that does deferUpdate/Reply based on mode
const ListSet = require('../models/ListSet');
const Card = require('../models/Card');
const UserInventory = require('../models/UserInventory');
const UserRecord = require('../models/UserRecord');
const generateStars = require('../utils/starGenerator');
const { handleRefundButtons } = require('../utils/refundSession');
const { REFUND_VALUES } = require('../commands/global/refund');
const InventoryItem = require('../models/InventoryItem');
const iprvView = require('../components/indexprivacy.view.handler');

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/* ---------- small helpers (kept) ---------- */
async function getSourceMessage(interaction) {
  try {
    return interaction.message || await interaction.fetchReply();
  } catch (err) {
    console.warn('Failed to fetch message:', err.message);
    return null;
  }
}
function isOwnerOfMessage(interaction) {
  // Only enforce when Discord attached metadata; otherwise allow
  const ownerId = interaction.message?.interaction?.user?.id;
  return !ownerId || ownerId === interaction.user.id;
}
/* ----------------------------------------- */

module.exports = async function interactionRouter(interaction) {

  // ─────────────────────────────────────────
  // A) COMPONENTS (Buttons / Menus)
  // ─────────────────────────────────────────
  if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
    // Ack once for components
    if (!interaction.deferred && !interaction.replied) {
      try {
        await interaction.deferUpdate();
      } catch (err) {
        const code = err?.code || err?.rawError?.code;
        if (code !== 10062 && code !== 40060 && code !== 'InteractionAlreadyReplied') {
          console.warn('router deferUpdate failed:', err?.message || err);
        }
      }
  // This will only catch customIds starting with 'iprv|'
  await iprvView.handle(interaction);
  return; // important: stop here so nothing else tries to handle it
    }

    // 1) /recommend moderation buttons first: rec:<action>:<submissionId>
    if (interaction.isButton()) {
      const [ns, action, id] = String(interaction.customId || '').split(':');
      if (ns === 'rec' && id) {
        if (!interaction.member.roles.cache.has(process.env.MAIN_BYPASS_ID)) {
            return safeReply(interaction, { content: 'You do not have permission to use this command.' });
            }

        const settings = await RecommendSettings.findOne({ guildId: interaction.guildId });
        const sub = await RecommendSubmission.findById(id);
        if (!settings || !sub) {
          return interaction.followUp({ content: 'Missing settings or submission.', flags: 1 << 6 });
        }
        if (!['pending', 'approved'].includes(sub.status)) {
          return interaction.followUp({ content: `Already **${sub.status}**.`, flags: 1 << 6 });
        }

        if (action === 'approve') {
          // post to thread
          const thread = await interaction.client.channels.fetch(settings.threadId).catch(() => null);
          if (!thread?.isThread?.()) {
            return interaction.followUp({ content: 'Thread not accessible.', flags: 1 << 6 });
          }

          const embed = new EmbedBuilder()
            .setTitle('New Recommendation')
            .setColor(0x5865F2)
            .addFields(
              { name: 'Name',  value: sub.name,  inline: true },
              { name: 'Group', value: sub.group, inline: true },
              ...(sub.category ? [{ name: 'Category', value: sub.category, inline: true }] : [])
            )
            .setTimestamp();

          const sent = await thread.send({ embeds: [embed] }).catch(() => null);
          if (!sent) return interaction.followUp({ content: 'Failed to post in the thread.', flags: 1 << 6 });

          const rx = settings.reaction || '<:e_heart:1410767827857571961>';
          try { await sent.react(rx); } catch { try { await sent.react('<:e_heart:1410767827857571961>'); } catch {} }

          sub.status = 'approved';
          sub.postedMessageId = sent.id;
          await sub.save();

          // disable buttons + add link on the mod card
          const base = interaction.message?.embeds?.[0]
            ? EmbedBuilder.from(interaction.message.embeds[0])
            : new EmbedBuilder().setTitle('Recommendation');
          await interaction.editReply({
            components: [],
            embeds: [
              base
                .setTitle('Recommendation Approved')
                .setColor(0x57F287)
                .addFields({ name: 'Link', value: sent.url })
            ]
          });
          return;
        }

        if (action === 'reject') {
          sub.status = 'rejected';
          await sub.save();

          const base = interaction.message?.embeds?.[0]
            ? EmbedBuilder.from(interaction.message.embeds[0])
            : new EmbedBuilder().setTitle('Recommendation');
          await interaction.editReply({
            components: [],
            embeds: [ base.setTitle('Recommendation Rejected').setColor(0xED4245) ]
          });
          return;
        }
      }
    }

    // 2) Your other component handlers (unchanged logic, just placed correctly)

    const { customId, user } = interaction;
    const id = interaction.customId ?? '';
    const msgId = interaction.message?.id;

    /* 🎯 Battle Answer Buttons */
    if (customId?.startsWith('question')) {
      const message = await getSourceMessage(interaction);
      if (!message) {
        return safeReply(interaction, { content: 'This interaction expired.', flags: 1 << 6 });
      }
      if (!isOwnerOfMessage(interaction)) {
        return safeReply(interaction, { content: 'These buttons are not yours.', flags: 1 << 6 });
      }

      await autoDefer(interaction, 'update');

      const [, questionId, selectedIndexRaw] = customId.split('_');
      const selectedIndex = parseInt(selectedIndexRaw, 10);

      if (!mongoose.Types.ObjectId.isValid(questionId)) {
        return safeReply(interaction, { content: 'Invalid question ID.' });
      }

      try {
        const embedMsg = message.embeds?.[0];
        if (!embedMsg?.description) {
          return safeReply(interaction, { content: 'Question data missing.' });
        }

        const selected = await Question.findById(questionId);
        if (!selected) return safeReply(interaction, { content: 'Question not found.' });
        const selectedAnswer = selected.options[selectedIndex];

        const userDoc =
          (await User.findOne({ userId: user.id })) ||
          new User({ userId: user.id, username: user.username });

        if (selectedAnswer === selected.correct) {
          userDoc.correctStreak = (userDoc.correctStreak || 0) + 1;

          let rewardPatterns = 0;
          let rewardSopop = 0;
          if (selected.difficulty === 'easy') {
            rewardPatterns = getRandomInt(2000, 2500);
            if (Math.random() < 0.23) rewardSopop = 0;
          } else if (selected.difficulty === 'hard') {
            rewardPatterns = getRandomInt(2700, 3250);
            if (Math.random() < 0.27) rewardSopop = 0;
          } else if (selected.difficulty === 'impossible') {
            rewardPatterns = getRandomInt(3400, 4000);
            if (Math.random() < 0.32) rewardSopop = 0;
          }

          let streakBonus = '';
          if (userDoc.correctStreak % 20 === 0) {
            rewardPatterns += 2750;
            rewardSopop += 0;
            streakBonus = '\n**Bonus rewards granted!**';
          }

          userDoc.patterns += rewardPatterns;
          userDoc.sopop += rewardSopop;
          await userDoc.save();

          await interaction.editReply({
            content: `Correct! You earned <:ehx_patterns:1389584144895315978> **${rewardPatterns} Patterns**.\n${streakBonus}`,
            embeds: [],
            components: [],
            files: []
          });
        } else {
          await User.findOneAndUpdate({ userId: user.id }, { $set: { correctStreak: 0 } });
          await interaction.editReply({
            content: `Incorrect! The correct answer was **${selected.correct}**.`,
            embeds: [],
            components: [],
            files: []
          });
        }
      } catch (err) {
        console.error('Error handling battle button:', err);
        return safeReply(interaction, { content: 'An error occurred processing your answer.' });
      }
      return;
    }

    // --- Let /refund session claim the generic IDs for its own message ---
    const handledRefund = await handleRefundButtons(interaction, { Card, User, InventoryItem, REFUND_VALUES });
    if (handledRefund) return;

    // ---- HELP PAGES (message-scoped) ----
    interaction.client.cache ??= {};
    interaction.client.cache.help ??= {};
    const helpSession = interaction.client.cache.help[msgId];

    if (helpSession && id.startsWith('help:')) {
      if (helpSession.ownerId && helpSession.ownerId !== interaction.user.id) {
        await interaction.followUp({ content: 'Only the command invoker can change these pages.', ephemeral: interaction.inGuild() });
        return;
      }

      const total = helpSession.pages.length;
      let page = helpSession.page;

      if (id === 'help:first') page = 0;
      else if (id === 'help:prev') page = Math.max(0, page - 1);
      else if (id === 'help:next') page = Math.min(total - 1, page + 1);
      else if (id === 'help:last') page = total - 1;

      helpSession.page = page;

      const makeRow = (pageIdx) => new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('help:first').setStyle(ButtonStyle.Secondary)
          .setDisabled(pageIdx === 0)
          .setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
        new ButtonBuilder().setCustomId('help:prev').setStyle(ButtonStyle.Primary)
          .setDisabled(pageIdx === 0)
          .setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
        new ButtonBuilder().setCustomId('help:next').setStyle(ButtonStyle.Primary)
          .setDisabled(pageIdx >= total - 1)
          .setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
        new ButtonBuilder().setCustomId('help:last').setStyle(ButtonStyle.Secondary)
          .setDisabled(pageIdx >= total - 1)
          .setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
      );

      const embed = EmbedBuilder.from(helpSession.pages[page])
        .setFooter({ text: `Page ${page + 1} of ${total}` });

      await interaction.editReply({ embeds: [embed], components: [makeRow(page)] });
      return;
    }

    if (customId?.startsWith('catpref:')) {
  const cat = customId.split(':')[1];
  const userDoc = await User.findOne({ userId: user.id }) || new User({ userId: user.id });

  const currentPrefs = new Set(userDoc.preferredCategories || []);
  currentPrefs.has(cat) ? currentPrefs.delete(cat) : currentPrefs.add(cat);

  userDoc.preferredCategories = Array.from(currentPrefs);
  await userDoc.save();

  const embed = EmbedBuilder.from(interaction.message.embeds?.[0]);
  embed.spliceFields(0, 1, {
    name: 'Current Preferences',
    value: userDoc.preferredCategories.length
      ? userDoc.preferredCategories.map(c => `• ${c}`).join('\n')
      : '_All categories (default)_'
  });

  await interaction.editReply({
    embeds: [embed],
    components: [interaction.message.components[0]]
  });
  return;
}


    /* Universal simple pager (kept) */
    const navPattern = /^(first|prev|next|last|copy)$/;
    if (navPattern.test(customId || '')) {
      const pageData = interaction.message.embeds?.[0]?.footer?.text?.match(/Page (\d+)\/(\d+)/);
      if (!pageData) return;

      let [, currentPage, totalPages] = pageData.map(Number);
      if (customId === 'first') currentPage = 1;
      if (customId === 'prev') currentPage = Math.max(1, currentPage - 1);
      if (customId === 'next') currentPage = Math.min(totalPages, currentPage + 1);
      if (customId === 'last') currentPage = totalPages;

      if (customId === 'copy') {
        const slice = session.entries.slice(page * perPage, page * perPage + perPage);
        const codes = slice.map(c => c.cardCode).join(', ');
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `${codes}`, flags: 1 << 6 }).catch(()=>{});
        } else {
          await interaction.followUp({ content: `${codes}`, flags: 1 << 6 }).catch(()=>{});
        }
        return;
      }

      const updatedEmbed = JSON.parse(JSON.stringify(interaction.message.embeds[0]));
      updatedEmbed.footer.text = `Page ${currentPage}/${totalPages}`;
      updatedEmbed.description = `This is page ${currentPage}.`;

      await interaction.editReply({ embeds: [updatedEmbed] });
      return;
    }

    /* 🛒 Stall Section (kept) */
    const { stallPreviewFilters } = require('../utils/cache');
const stallPreview = require('../commands/global/subcommands/stallpreview');
const MarketListing = require('../models/MarketListing');        // ⬅️ add

// include stall_copy here:
const stallPattern = /^(stall_first|stall_prev|stall_next|stall_last|stall_copy)$/;

if (stallPattern.test(customId || '')) {
  const msg = await getSourceMessage(interaction);
  if (!msg) {
    return safeReply(interaction, { content: 'This stall preview expired.', flags: 1 << 6 });
  }
  if (!isOwnerOfMessage(interaction)) {
    return safeReply(interaction, { content: "You can't use buttons for someone else’s command.", flags: 1 << 6 });
  }

  // Read current page from the embed title
  const embed = msg.embeds?.[0];
  const match = embed?.title?.match(/Page (\d+)\/(\d+)/);
  if (!match || match.length < 3) {
    return interaction.editReply?.({ content: 'Could not read current page.', components: [] });
  }
  let [, currentPage, totalPages] = match.map(Number);

  // Pull the cached filters we stored when rendering the page
  const previousFilters = stallPreviewFilters.get(msg.id) || {};
  const {
    names = [], groups = [], eras = [],
    rarity, rarities = [],
    seller, cheapest, newest, unowned,
    perPage = 1, compact = false
  } = previousFilters;

  // === COPY BUTTON ===
  if (customId === 'stall_copy') {
    // Build the exact same Mongo filter the preview uses
    const filter = {};
    if (names.length)  filter.cardName = { $in: names.map(n => new RegExp(`^${escapeRegex(n)}$`, 'i')) };
    if (groups.length) filter.group    = { $in: groups.map(g => new RegExp(`^${escapeRegex(g)}$`, 'i')) };
    if (eras.length)   filter.era      = { $in: eras.map(e => new RegExp(`^${escapeRegex(e)}$`, 'i')) };
    if (Array.isArray(rarities) && rarities.length) filter.rarity = { $in: rarities };
    else if (Number.isInteger(rarity)) filter.rarity = rarity;
    if (seller?.id) filter.sellerId = seller.id;

    if (unowned) {
      const inv = await InventoryItem.find({ userId: interaction.user.id })
        .select({ cardCode: 1, _id: 0 }).lean();
      const ownedCodes = inv.map(x => x.cardCode);
      filter.cardCode = { $nin: ownedCodes };
    }

    const sort = cheapest ? { price: 1 } : (newest ? { createdAt: -1 } : { createdAt: 1 });
    const skip = (currentPage - 1) * perPage;

    const listings = await MarketListing.find(filter)
      .sort(sort).skip(skip).limit(perPage).select({ buyCode: 1, _id: 0 }).lean();

    const codes = listings.map(l => l.buyCode).filter(Boolean);
    const text  = codes.length ? `${codes.join(', ')}` : '_No buy codes on this page_';

    // Send as ephemeral reply (don’t update the preview message)
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({ content: text, flags: 1 << 6 });     // ephemeral
    } else {
      await interaction.followUp({ content: text, flags: 1 << 6 });  // ephemeral
    }
    return; // done
  }

  // === NAV BUTTONS ===
  // Only defer-update for navigation; we are going to edit the original message
  await autoDefer(interaction, 'update');

  if (customId === 'stall_first') currentPage = 1;
  if (customId === 'stall_prev')  currentPage = Math.max(1, currentPage - 1);
  if (customId === 'stall_next')  currentPage = Math.min(totalPages, currentPage + 1);
  if (customId === 'stall_last')  currentPage = totalPages;

  await stallPreview(interaction, { ...previousFilters, page: currentPage, delivery: 'update' });
  return;
}

// tiny helper (copy-paste from preview file)
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MysterySession = require('../models/MysterySession');
const pickRarity = require('../utils/rarityPicker');
const getRandomCardByRarity = require('../utils/randomCardFromRarity');
const generateStars = require('../utils/starGenerator');

// 🎯 MYSTERY BUTTON HANDLER
if (interaction.customId?.startsWith('mystery:')) {
  const [, sessionId, idxStr] = interaction.customId.split(':');
  const idx = parseInt(idxStr, 10);
  const session = await MysterySession.findOne({ sessionId });
  const message = interaction.message;

  if (!session || session.userId !== interaction.user.id) {
    return interaction.followUp({ content: "This isn't your mystery session or it's expired.", flags: 1 << 6 });
  }

  if (session.clicks.length >= 3 || session.clicks.some(c => c.idx === idx)) {
    return interaction.followUp({ content: "You've already clicked this or used all 3 picks.", flags: 1 << 6 });
  }

  const outcome = session.outcomes[idx];
  let newClick = { idx, outcome };
  const userId = interaction.user.id;

  // 📦 CARD GAIN
  if (outcome === 'card_gain') {
  const rarity = await pickRarity();
  const card = await getRandomCardByRarity(rarity, userId);
  if (card) {
    await InventoryItem.findOneAndUpdate(
      { userId: session.userId, cardCode: card.cardCode },
      { $inc: { quantity: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    newClick.cardCode = card.cardCode;

    await UserRecord.create({
      userId: session.userId,
      type: 'mystery_card',
      detail: `Gained ${card.name} (${card.cardCode}) [${card.rarity}] from karaoke`
    });
  }
}

  // 💰 CURRENCY GAIN/LOSS
  if (['currency_gain', 'currency_loss'].includes(outcome)) {
    const userDoc = await User.findOne({ userId: session.userId }) || new User({ userId: session.userId });
    const gain = outcome === 'currency_gain'
  ? Math.floor(Math.random() * (2000 - 1250 + 1)) + 1250  // 700–900
  : -1 * (Math.floor(Math.random() * (900 - 600 + 1)) + 600); // -300 to -500
    userDoc.patterns = (userDoc.patterns || 0) + gain;
    await userDoc.save();
    newClick.amount = gain;
    await UserRecord.create({
  userId: session.userId,
  type: 'mystery_currency',
  detail: `${gain > 0 ? 'Gained' : 'Lost'} ${Math.abs(gain)} Patterns from karaoke`
});
  }

  // 🧠 Update session in DB
  await MysterySession.updateOne({ sessionId }, { $push: { clicks: newClick } });

  // 🎭 Emoji Map
  const emojiMap = {
    card_gain: '<:e_pull:1393002254499581982>',
    currency_gain: '<:ehx_patterns:1389584144895315978>',
    currency_loss: '<:rhx_crosspink:1388193594724323550>',
    nothing: '<a:hx_barks:1388132672651526294>'
  };
// 🧠 Get latest session with newClick included
const updatedSession = await MysterySession.findOne({ sessionId });

// 🎨 Update buttons to show clicked emojis
const newRows = message.components.map(row => {
  const newRow = new ActionRowBuilder();
  for (const btn of row.components) {
    const thisIdx = parseInt(btn.customId.split(':')[2], 10);
    const clicked = updatedSession.clicks.find(c => c.idx === thisIdx);
    const newBtn = ButtonBuilder.from(btn).setDisabled(!!clicked);
    if (clicked) {
      newBtn.setEmoji(emojiMap[clicked.outcome]);
    }
    newRow.addComponents(newBtn);
  }
  return newRow;
});

  const isFinal = updatedSession.clicks.length >= 3;

if (isFinal) {
  const final = await MysterySession.findOne({ sessionId });

  const resultFields = await Promise.all(final.clicks.map(async (c, i) => {
    const label = `#${c.idx + 1}`;
    if (c.outcome === 'card_gain' && c.cardCode) {
      const card = await Card.findOne({ cardCode: c.cardCode });
      if (!card) return null;

      const stars = generateStars({ rarity: card.rarity, overrideEmoji: card.emoji });
      const owned = await InventoryItem.findOne({ userId: session.userId, cardCode: card.cardCode });
      const copies = owned?.quantity || 1;

      return {
        name: `${label} • ${stars} ${card.name}`,
        value: `Code: \`${card.cardCode}\`\nGroup: **${card.group}**\nCopies: **${copies}**`,
        inline: false
      };
    }

    if (['currency_gain', 'currency_loss'].includes(c.outcome)) {
      return {
        name: `${label} • ${emojiMap[c.outcome]} ${c.amount > 0 ? 'Gained' : 'Lost'}`,
        value: `**${Math.abs(c.amount)} Patterns**`,
        inline: false
      };
    }

    return {
      name: `${label} • ${emojiMap[c.outcome]} Nothing`,
      value: '_No reward from this one._',
      inline: false
    };
  }));

  const resultEmbed = new EmbedBuilder()
    .setTitle('Mystery\'s Karaoke Results')
    .setDescription('Here’s what you received from your 3 choices!')
    .addFields(resultFields.filter(Boolean))
    .setColor(0xff90b3)
    .setFooter({ text: `Session completed • ${new Date().toLocaleTimeString()}` });

  await interaction.editReply({
    embeds: [resultEmbed],
    components: newRows
  });

  await MysterySession.deleteOne({ sessionId });
} else {
  // show updated buttons (with emoji for what they clicked so far)
  await interaction.editReply({
    components: newRows
  });
}
}

    /* ⬇️ Template select menu (kept) */
    if (customId === 'select_template') {
      await autoDefer(interaction, 'update');

      const templateOptions = require('../data/templateOptions');
      const userId = interaction.user.id;

      const userDoc = await User.findOne({ userId });
      if (!userDoc) return interaction.editReply({ content: 'User not found.' });

      const selectedId = interaction.values[0];
      const template = templateOptions.find(t => t.id === selectedId);
      if (!template) return interaction.editReply({ content: 'Invalid template selected.' });

      if (userDoc.templatesOwned?.includes(template.id)) {
        return interaction.editReply({ content: `You already own **${template.name}**.` });
      }

      if (userDoc.patterns < template.price) {
        return interaction.editReply({
          content: `You need ${template.price.toLocaleString()} Pattern (you have ${userDoc.patterns.toLocaleString()}).`,
        });
      }

      userDoc.patterns -= template.price;
      userDoc.templatesOwned = [...(userDoc.templatesOwned || []), template.id];
      await userDoc.save();

      await UserRecord.create({
        userId,
        type: 'templatepurchase',
        detail: `Bought ${template.name} for ${template.price}`
      });

      await interaction.editReply({
        content: `You bought **${template.name}** for ${template.price.toLocaleString()} Patterns!`,
      });
      return;
    }

    /* 🎵 Rehearsal pick buttons (kept) */
// helper to disable all buttons on the message
function disableAllComponents(msg) {
  const disabledRows = msg.components.map(row => {
    const r = new ActionRowBuilder();
    for (const comp of row.components) {
      r.addComponents(
        ButtonBuilder.from(comp).setDisabled(true)
      );
    }
    return r;
  });
  return disabledRows;
}

if (interaction.customId?.startsWith('rehearsal_')) {
  const msg = interaction.message;               // the original message with buttons
  const msgId = msg.id;
  const index = Number(interaction.customId.split('_')[1] || 0);

  // session lookup
  const sessions = interaction.client.cache?.rehearsalSessions || {};
  const session = sessions[msgId];
  if (!session) {
    return interaction.followUp({ content: 'This rehearsal session has expired.', flags: 1 << 6 }).catch(()=>{});
  }

  // only the original user can click
  if (interaction.user.id !== session.userId) {
    return interaction.followUp({ content: 'These buttons are not yours.', flags: 1 << 6 }).catch(()=>{});
  }

  // ❗ single-click guard (in-memory)
  if (session.claimed) {
    // If someone managed to click again, just let them know
    return interaction.followUp({ content: 'You already chose a card for this session.', flags: 1 << 6 }).catch(()=>{});
  }
  // Flip the flag immediately to block any more clicks in this process
  session.claimed = true;

  // Immediately disable buttons on the message (UX + reduces race)
  try {
    await interaction.editReply({ components: disableAllComponents(msg) });
  } catch {}

  // OPTIONAL (cross-process safety): DB lock (shown below in section C)
  // if (!(await claimRehearsalOnce(msgId, session.userId))) {
  //   return interaction.followUp({ content: 'Already claimed.', ephemeral: true }).catch(()=>{});
  // }

  // proceed with reward & inventory
  const selected = session.pulls[index] || session.pulls[0];
  const patterns = getRandomInt(2500, 4500);

  // give currency (your existing helper)
  const giveCurrency = require('../utils/giveCurrency');
  await giveCurrency(session.userId, { patterns });

  // inventory +1 (atomic upsert)
  const updated = await InventoryItem.findOneAndUpdate(
    { userId: session.userId, cardCode: selected.cardCode },
    { $setOnInsert: { userId: session.userId, cardCode: selected.cardCode }, $inc: { quantity: 1 } },
    { upsert: true, new: true, projection: { quantity: 1, _id: 0 } }
  );
  const copies = updated.quantity;

  await UserRecord.create({
    userId: session.userId,
    type: 'rehearsal',
    detail: `Chose ${selected.name} (${selected.cardCode}) [${selected.rarity}]`
  });

  // Build result embed
  const imageAttachment = selected.localImagePath
    ? new AttachmentBuilder(selected.localImagePath, { name: `${selected._id || 'preview'}.png` })
    : null;

  const imageSource = selected.localImagePath
    ? `attachment://${selected._id || 'preview'}.png`
    : (selected.discordPermalinkImage || selected.imgurImageLink);

  const showEraFor = new Set(['kpop', 'zodiac', 'event']);
  const stars = generateStars({ rarity: selected.rarity, overrideEmoji: selected.emoji ?? undefined });

  const result = new EmbedBuilder()
    .setTitle(`You chose: ${selected.name}`)
    .setDescription([
      `**${stars}**`,
      `**Group:** ${selected.group}`,
      ...(showEraFor.has((selected.category || '').toLowerCase()) && selected.era ? [`**Era:** ${selected.era}`] : []),
      `**Code:** \`${selected.cardCode}\``,
      `**Copies Owned:** ${copies > 0 ? copies : 'Unowned'}`,
      `\n__Reward__:\n${patterns ? `• <:ehx_patterns:1389584144895315978> **${patterns}** Patterns` : '• <:ehx_patterns:1389584144895315978> 0 Patterns'}`
    ].join('\n'))
    .setColor('#FFD700');

  if (imageSource) result.setImage(imageSource);

  // Finalize message (embed + keep components disabled)
  await interaction.editReply({
    embeds: [result],
    components: [],
    files: imageAttachment ? [imageAttachment] : []
  });

  // cleanup memory so later clicks say "expired"
  delete interaction.client.cache.rehearsalSessions[msgId];
}


    /* 📇 Index pager (kept) */
    interaction.client.cache ??= {};
    interaction.client.cache.indexSessions ??= {};

    const m = /^index:(first|prev|next|last|copy)$/.exec(customId || '');
    if (m) {
      const action = m[1];
      const session = interaction.client.cache.indexSessions[msgId];

      if (!session) {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.followUp({ content: 'This index view expired. Run /index again.', flags: 1 << 6 }).catch(()=>{});
        }
        return;
      }
      const ownerId = interaction.message?.interaction?.user?.id;
      if (ownerId && interaction.user.id !== ownerId) {
        await interaction.followUp({ content: "These buttons aren't yours.", flags: 1 << 6 }).catch(()=>{});
        return;
      }

      const footer = interaction.message.embeds?.[0]?.footer?.text || '';
      const match = footer.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
      let page = Math.max(0, (match ? (parseInt(match[1], 10) - 1) : 0));
      const perPage = session.perPage;
      const totalPages = session.totalPages;

      if (action === 'first') page = 0;
      if (action === 'prev')  page = Math.max(0, page - 1);
      if (action === 'next')  page = Math.min(totalPages - 1, page + 1);
      if (action === 'last')  page = totalPages - 1;

      if (action === 'copy') {
        const slice = session.entries.slice(page * perPage, page * perPage + perPage);
        const codes = slice.map(c => c.cardCode).join(', ');
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `${codes}`, flags: 1 << 6 }).catch(()=>{});
        } else {
          await interaction.followUp({ content: `${codes}`, flags: 1 << 6 }).catch(()=>{});
        }
        return;
      }

      const slice = session.entries.slice(page * perPage, page * perPage + perPage);
      const description = slice.map(card => {
        const stars = card.stars;
         const showEraFor = new Set(['kpop', 'zodiac', 'event']);
         const eraPart = showEraFor.has(card.category) && card.era ? ` | Era: ${card.era}` : '';
        return `**${stars} ${card.name}**\nGroup: ${card.group}${eraPart} | Code: \`${card.cardCode}\` | Copies: ${card.copies}`;
      }).join('\n\n');

      const embed = {
        ...interaction.message.embeds[0].data,
        description,
        footer: {
          text: `Page ${page + 1} of ${totalPages} • Total Cards: ${session.totalCards} • Total Copies: ${session.totalCopies} • Total Stars: ${session.totalStars}`
        }
      };
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('index:first').setStyle(ButtonStyle.Secondary).setDisabled(page === 0).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
        new ButtonBuilder().setCustomId('index:prev').setStyle(ButtonStyle.Primary).setDisabled(page === 0).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
        new ButtonBuilder().setCustomId('index:next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1).setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
        new ButtonBuilder().setCustomId('index:last').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
        new ButtonBuilder().setCustomId('index:copy').setLabel('Copy Codes').setStyle(ButtonStyle.Success)
      );
      await interaction.editReply({ embeds: [embed], components: [row] }).catch(e => console.warn('index edit fail:', e.message));
      return;
    }

    /* Showcase (kept) */
    const showcasePattern = /^(show_first|show_prev|show_next|show_last)$/;
    if (showcasePattern.test(customId || '')) {
      const userId = interaction.user.id;
      const showcasePages = interaction.client.cache?.showcase?.[userId];

      if (!showcasePages?.length) {
        await interaction.editReply({
          content: 'Showcase session expired or not found.',
          embeds: [],
          components: []
        });
        return;
      }

      const currentEmbed = interaction.message.embeds[0];
      let current = showcasePages.findIndex(p =>
        p.embed?.data?.title === currentEmbed.title &&
        p.embed?.data?.description === currentEmbed.description
      );
      if (current === -1) current = 0;

      if (customId === 'show_first') current = 0;
      else if (customId === 'show_prev') current = (current - 1 + showcasePages.length) % showcasePages.length;
      else if (customId === 'show_next') current = (current + 1) % showcasePages.length;
      else if (customId === 'show_last') current = showcasePages.length - 1;

      const page = showcasePages[current];

      await interaction.editReply({
        embeds: [page.embed],
        components: [interaction.message.components[0]],
        files: page.attachment ? [page.attachment] : []
      });
      return;
    }

    // interaction router excerpt
const cdPattern = /^(cd_first|cd_prev|cd_next|cd_last|cd_close)$/;

if (cdPattern.test(customId || '')) {
  const userId = interaction.user.id;
  const pages = interaction.client.cache?.viewcds?.[userId];

  if (!pages?.length) {
    await interaction.editReply({
      content: 'CD viewer session expired or not found.',
      embeds: [],
      components: []
    });
    return;
  }

  // We store current page index in the header footer: "Page X/Y"
  const header = interaction.message.embeds?.[0];
  let current = 0;
  const m = header?.footer?.text?.match(/Page\s+(\d+)\/(\d+)/i);
  if (m) current = Math.max(0, Math.min(pages.length - 1, parseInt(m[1], 10) - 1));

  if (customId === 'cd_first') current = 0;
  else if (customId === 'cd_prev') current = (current - 1 + pages.length) % pages.length;
  else if (customId === 'cd_next') current = (current + 1) % pages.length;
  else if (customId === 'cd_last') current = pages.length - 1;
  else if (customId === 'cd_close') {
    await interaction.editReply({ content: 'Viewer closed.', embeds: [], components: [] });
    return;
  }

  const page = pages[current];

  await interaction.editReply({
    embeds: page.embeds,
    components: [interaction.message.components[0]],
    files: page.files ?? []
  });

  return;
}


    /*** ✨ TEMPLATE PREVIEW PAGER (like /showcase) ✨ ***/
{
  const tplPattern = /^(tpl_first|tpl_prev|tpl_next|tpl_last)$/;
  if (tplPattern.test(customId || '')) {
    const userId = interaction.user.id;
    const pages = interaction.client.cache?.tplPreview?.[userId];

    if (!pages?.length) {
      await interaction.editReply({
        content: 'Template preview session expired or not found.',
        embeds: [],
        components: [],
        files: []
      }).catch(()=>{});
      return;
    }

    // find current slide by comparing title/desc like your showcase handler does
    const currentEmbed = interaction.message.embeds?.[0];
    let current = pages.findIndex(p =>
      p.embed?.data?.title === currentEmbed?.title &&
      p.embed?.data?.description === currentEmbed?.description
    );
    if (current === -1) current = 0;

    if (customId === 'tpl_first') current = 0;
    else if (customId === 'tpl_prev') current = (current - 1 + pages.length) % pages.length;
    else if (customId === 'tpl_next') current = (current + 1) % pages.length;
    else if (customId === 'tpl_last') current = pages.length - 1;

    const page = pages[current];

    // rebuild pager row for enabled/disabled state
    const makeRow = (pageIdx, total) => new (require('discord.js').ActionRowBuilder)().addComponents(
      new (require('discord.js').ButtonBuilder)().setCustomId('tpl_first').setStyle(require('discord.js').ButtonStyle.Secondary)
        .setDisabled(pageIdx === 0)
        .setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new (require('discord.js').ButtonBuilder)().setCustomId('tpl_prev').setStyle(require('discord.js').ButtonStyle.Primary)
        .setDisabled(pageIdx === 0)
        .setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new (require('discord.js').ButtonBuilder)().setCustomId('tpl_next').setStyle(require('discord.js').ButtonStyle.Primary)
        .setDisabled(pageIdx >= total - 1)
        .setEmoji({ id: '1390462706544410704', name: ':ehx_rightarrow' }),
      new (require('discord.js').ButtonBuilder)().setCustomId('tpl_last').setStyle(require('discord.js').ButtonStyle.Secondary)
        .setDisabled(pageIdx >= total - 1)
        .setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
    );

    await interaction.editReply({
      embeds: [page.embed],
      components: [makeRow(current, pages.length)],
      files: page.attachment ? [page.attachment] : []
    }).catch(()=>{});
    return;
  }
}

/*** end: TEMPLATE PREVIEW PAGER ***/


    // 📋 LIST CLAIM BUTTONS (kept)
    if (interaction.isButton() && interaction.customId?.startsWith('listclaim:')) {
      const userId = interaction.user.id;

      // 2-minute GLOBAL cooldown key
      const CLAIM_COMMAND = 'ListClaim';
      const CLAIM_COOLDOWN_MS = 3 * 60 * 1000;

      const cooldowns = require('../utils/cooldownManager');

      if (await cooldowns.isOnCooldown(userId, CLAIM_COMMAND)) {
        const ts = await cooldowns.getCooldownTimestamp(userId, CLAIM_COMMAND);
        try {
          await interaction.followUp({
            content: `You must wait **${ts}** before claiming another list slot.`,
            ephemeral: interaction.inGuild()
          });
        } catch {}
        return;
      }

      if (!interaction.deferred && !interaction.replied) {
        try { await interaction.deferUpdate(); } catch {}
      }

      const [, setId, idxStr] = interaction.customId.split(':');
      const idx = parseInt(idxStr, 10);
      const now = new Date();

      const set = await ListSet.findOneAndUpdate(
        {
          _id: setId,
          expiresAt: { $gt: now },
          'slots.idx': idx,
          'slots.claimedBy': null,
          claimers: { $ne: userId }
        },
        {
          $set: { 'slots.$.claimedBy': userId, 'slots.$.claimedAt': now },
          $addToSet: { claimers: userId }
        },
        { new: true }
      );

      if (!set) {
        try {
          await interaction.followUp({
            content: 'That slot is unavailable (already claimed/expired) or you already claimed one in this list.',
            ephemeral: interaction.inGuild()
          });
        } catch {}
        return;
      }

      await cooldowns.setCooldown(userId, CLAIM_COMMAND, CLAIM_COOLDOWN_MS);

      const slot = set.slots.find(s => s.idx === idx);
      if (!slot) {
        try { await interaction.followUp({ content: 'Could not locate that slot.', ephemeral: interaction.inGuild() }); } catch {}
        return;
      }

      const card = await Card.findById(slot.cardId);
      if (!card) {
        try { await interaction.followUp({ content: 'The card for that slot no longer exists.', ephemeral: interaction.inGuild() }); } catch {}
        return;
      }

      // Grant inventory
      const updated = await InventoryItem.findOneAndUpdate(
        { userId: interaction.user.id, cardCode: card.cardCode },
        { $inc: { quantity: 1 } },
        {
          upsert: true,
          new: true,                 // return the post-update doc
          setDefaultsOnInsert: true,
          projection: { quantity: 1, _id: 0 }
        }
      );
      
      const copies = updated.quantity;

      await UserRecord.create({
        userId,
        type: 'listclaim',
        detail: `Claimed ${card.name} (${card.cardCode}) [${card.rarity}] from list ${setId} slot ${idx}`
      });

      // Reveal to claimer
      const imageSource = card.localImagePath
        ? `attachment://${card._id}.png`
        : (card.discordPermalinkImage || card.imgurImageLink);
      const files = card.localImagePath ? [new AttachmentBuilder(card.localImagePath, { name: `${card._id}.png` })] : [];
      const stars = generateStars({ rarity: card.rarity, overrideEmoji: card.emoji || '<:fullstar:1387609456824680528>' });
      const showEraFor = new Set(['kpop', 'zodiac', 'event']);
const cat = (card.category || '').toLowerCase();

      try {
        await interaction.followUp({
          ephemeral: interaction.inGuild(),
          embeds: [
            new EmbedBuilder()
              .setTitle(stars)
              .setColor('#57F287')
              .setDescription([
                `**You claimed slot:** ${idx}`,
                '',
                `**Group:** ${card.group}`,
                `**Name:** ${card.name}`,
                ...(showEraFor.has(cat) && card.era ? [`**Era:** ${card.era}`] : []),
                `**Code:** \`${card.cardCode}\``,
                `**Copies:** ${copies}`
              ].join('\n'))
              .setImage(imageSource)
              .setFooter({ text: `Claimed by ${interaction.user.username}` })
          ],
          files
        });
      } catch {}

      // Update original message buttons
      try {
        const msg = interaction.message?.id
          ? interaction.message
          : await (await interaction.client.channels.fetch(set.channelId)).messages.fetch(set.messageId);

        const rows = (msg.components ?? []).map(row => {
          const newRow = new ActionRowBuilder();
          for (const comp of row.components) {
            if (comp.customId?.startsWith('listclaim:')) {
              const parts = comp.customId.split(':');
              const compIdx = parseInt(parts[2], 10);
              const b = ButtonBuilder.from(comp);
              if (compIdx === idx) {
                b.setStyle(ButtonStyle.Secondary).setDisabled(true).setLabel(`${compIdx} • Claimed`);
              }
              newRow.addComponents(b);
            } else {
              newRow.addComponents(comp);
            }
          }
          return newRow;
        });

        if (rows.length) {
          const allClaimed = set.slots.every(s => !!s.claimedBy);
          const embed0 = msg.embeds?.[0];
          const updatedEmbed = embed0
            ? EmbedBuilder.from(embed0).setTitle(allClaimed ? 'Mystery Card List — all claimed' : (embed0.title || 'Mystery Card List'))
            : new EmbedBuilder().setTitle(allClaimed ? 'Mystery Card List — all claimed' : 'Mystery Card List');

          // Re-attach the blurred image so it stays inside the embed

// if the embed originally had an image, re-declare it explicitly
if (embed0?.image?.url?.startsWith('attachment://')) {
  updatedEmbed.setImage(embed0.image.url);
}

// 🆕 Fetch blurred buffer from DB and attach it again
const listSet = await ListSet.findById(setId);
let files = [];

if (listSet?.blurredBuffer) {
  const buffer = Buffer.from(listSet.blurredBuffer, 'base64');
  files = [{ attachment: buffer, name: 'list-blurred.png' }];
}

await msg.edit({
  embeds: [updatedEmbed],
  components: rows,
  files
});


        }
      } catch (e) {
        console.warn('listclaim: failed to update message:', e.message);
      }

      return;
    }

    // Nothing matched — done with components
    return;
  }

  // ─────────────────────────────────────────
  // C) SLASH COMMANDS
  // ─────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'recommend') {
      return recommendCommand.execute(interaction);
    }

    // your other slash commands (unchanged)…
    return; // important: stop after handling slash commands
  }

  // (Optional) other interaction types (autocomplete, modals)…
};
