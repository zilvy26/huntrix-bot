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
            rewardPatterns = getRandomInt(800, 900);
            if (Math.random() < 0.22) rewardSopop = 1;
          } else if (selected.difficulty === 'hard') {
            rewardPatterns = getRandomInt(950, 1035);
            if (Math.random() < 0.28) rewardSopop = 1;
          } else if (selected.difficulty === 'impossible') {
            rewardPatterns = getRandomInt(1085, 1150);
            if (Math.random() < 0.34) rewardSopop = 1;
          }

          let streakBonus = '';
          if (userDoc.correctStreak % 20 === 0) {
            rewardPatterns += 750;
            rewardSopop += 1;
            streakBonus = '\n**Bonus rewards granted!**';
          }

          userDoc.patterns += rewardPatterns;
          userDoc.sopop += rewardSopop;
          await userDoc.save();

          await interaction.editReply({
            content: `Correct! You earned <:ehx_patterns:1389584144895315978> **${rewardPatterns} Patterns**${rewardSopop ? ` and <:ehx_sopop:1389584273337618542> **${rewardSopop} Sopop**` : ''}.\n${streakBonus}`,
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
    const handledRefund = await handleRefundButtons(interaction, { Card, User, UserInventory, REFUND_VALUES });
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
          await interaction.reply({ content: `\n\`\`\`${codes}\`\`\``, flags: 1 << 6 }).catch(()=>{});
        } else {
          await interaction.followUp({ content: `\n\`\`\`${codes}\`\`\``, flags: 1 << 6 }).catch(()=>{});
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
    const stallPattern = /^(stall_first|stall_prev|stall_next|stall_last)$/;

    if (stallPattern.test(customId || '')) {
      const msg = await getSourceMessage(interaction);
      if (!msg) {
        return safeReply(interaction, { content: 'This stall preview expired.', flags: 1 << 6 });
      }

      if (!isOwnerOfMessage(interaction)) {
        return safeReply(interaction, { content: "You can't use buttons for someone else’s command.", flags: 1 << 6 });
      }

      await autoDefer(interaction, 'update');

      const embed = msg.embeds?.[0];
      const match = embed?.title?.match(/Page (\d+)\/(\d+)/);
      if (!match || match.length < 3) {
        return interaction.editReply({ content: 'Could not read current page.', components: [] });
      }

      let [, currentPage, totalPages] = match.map(Number);
      if (customId === 'stall_first') currentPage = 1;
      if (customId === 'stall_prev') currentPage = Math.max(1, currentPage - 1);
      if (customId === 'stall_next') currentPage = Math.min(totalPages, currentPage + 1);
      if (customId === 'stall_last') currentPage = totalPages;

      const previousFilters = stallPreviewFilters.get(msg.id) || {};
      await stallPreview(interaction, { ...previousFilters, page: currentPage, delivery: 'update' });
      return;
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

      if (userDoc.sopop < template.price) {
        return interaction.editReply({
          content: `You need ${template.price.toLocaleString()} Sopop (you have ${userDoc.sopop.toLocaleString()}).`,
        });
      }

      userDoc.sopop -= template.price;
      userDoc.templatesOwned = [...(userDoc.templatesOwned || []), template.id];
      await userDoc.save();

      await UserRecord.create({
        userId,
        type: 'templatepurchase',
        detail: `Bought ${template.name} for ${template.price}`
      });

      await interaction.editReply({
        content: `You bought **${template.name}** for ${template.price.toLocaleString()} Sopop!`,
      });
      return;
    }

    /* 🎵 Rehearsal pick buttons (kept) */
const InventoryItem = require('../models/InventoryItem');
const generateStars = require('../utils/starGenerator');

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
  const sopop = Math.random() < 0.42 ? (Math.random() < 0.75 ? 1 : 2) : 0;

  // give currency (your existing helper)
  const giveCurrency = require('../utils/giveCurrency');
  await giveCurrency(session.userId, { sopop });

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
      `\n__Reward__:\n${sopop ? `• <:ehx_sopop:1389584273337618542> **${sopop}** Sopop` : '• <:ehx_sopop:1389584273337618542> 0 Sopop'}`
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
          await interaction.reply({ content: `\n\`\`\`${codes}\`\`\``, flags: 1 << 6 }).catch(()=>{});
        } else {
          await interaction.followUp({ content: `\n\`\`\`${codes}\`\`\``, flags: 1 << 6 }).catch(()=>{});
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
      let inv = await UserInventory.findOne({ userId });
      if (!inv) inv = await UserInventory.create({ userId, cards: [] });

      const existing = inv.cards.find(c => c.cardCode === card.cardCode);
      let copies = 1;
      if (existing) { existing.quantity += 1; copies = existing.quantity; }
      else { inv.cards.push({ cardCode: card.cardCode, quantity: 1 }); }
      await inv.save();

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
                ...(card.category?.toLowerCase() === 'kpop' ? [`**Era:** ${card.era}`] : []),
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

          await msg.edit({ embeds: [updatedEmbed], components: rows });
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
