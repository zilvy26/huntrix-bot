const User = require('../models/User');
const Question = require('../models/Question');
const mongoose = require('mongoose');
const { AttachmentBuilder, ComponentType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const safeReply = require('../utils/safeReply');
const autoDefer = require('../utils/autoDefer'); // your helper that does deferUpdate/Reply based on mode
const ListSet = require('../models/ListSet');

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/* ---------- small helpers (NEW) ---------- */
async function getSourceMessage(interaction) {
  try {
    return interaction.message || await interaction.fetchReply();
  } catch (err) {
    console.warn('⚠️ Failed to fetch message:', err.message);
    return null;
  }
}
function isOwnerOfMessage(interaction) {
  // Only enforce when Discord attached metadata; otherwise allow
  const ownerId = interaction.message?.interaction?.user?.id;
  return !ownerId || ownerId === interaction.user.id;
}
/* ---------------------------------------- */

module.exports = async function interactionRouter(interaction) {
  const { customId, user } = interaction;

  /* 🎯 Battle Answer Buttons */
  if (customId?.startsWith('question')) {
    const message = await getSourceMessage(interaction);
    if (!message) {
      return safeReply(interaction, { content: '⚠️ This interaction expired.', flags: 1 << 6 });
    }
    if (!isOwnerOfMessage(interaction)) {
      return safeReply(interaction, { content: 'These buttons are not yours.', flags: 1 << 6 });
    }

    await autoDefer(interaction, 'update'); // ack the button

    const [, questionId, selectedIndexRaw] = customId.split('_');
    const selectedIndex = parseInt(selectedIndexRaw, 10);

    if (!mongoose.Types.ObjectId.isValid(questionId)) {
      return safeReply(interaction, { content: '❌ Invalid question ID.' });
    }

    try {
      const embedMsg = message.embeds?.[0];
      if (!embedMsg?.description) {
        return safeReply(interaction, { content: '❌ Question data missing.' });
      }

      const selected = await Question.findById(questionId);
      if (!selected) return safeReply(interaction, { content: '❌ Question not found.' });
      const selectedAnswer = selected.options[selectedIndex];

      const userDoc =
        (await User.findOne({ userId: user.id })) ||
        new User({ userId: user.id, username: user.username });

      if (selectedAnswer === selected.correct) {
        userDoc.correctStreak = (userDoc.correctStreak || 0) + 1;

        let rewardPatterns = 0;
        let rewardSopop = 0;
        if (selected.difficulty === 'easy') {
          rewardPatterns = getRandomInt(850, 975);
          if (Math.random() < 0.2) rewardSopop = 1;
        } else if (selected.difficulty === 'hard') {
          rewardPatterns = getRandomInt(975, 1100);
          if (Math.random() < 0.27) rewardSopop = 1;
        } else if (selected.difficulty === 'impossible') {
          rewardPatterns = getRandomInt(1100, 1250);
          if (Math.random() < 0.34) rewardSopop = 1;
        }

        let streakBonus = '';
        if (userDoc.correctStreak % 15 === 0) {
          rewardPatterns += 700;
          rewardSopop += 1;
          streakBonus = '\n**Streak bonus activated!** Extra rewards granted!';
        }

        userDoc.patterns += rewardPatterns;
        userDoc.sopop += rewardSopop;
        await userDoc.save();

        await interaction.editReply({
          content: `Correct! You earned <:ehx_patterns:1389584144895315978> **${rewardPatterns} Patterns**${rewardSopop ? ` and <:ehx_sopop:1389584273337618542> **${rewardSopop} Sopop**` : ''}.\nCurrent streak: **${userDoc.correctStreak}**${streakBonus}`,
          embeds: [],
          components: [],
          files: []
        });
      } else {
        await User.findOneAndUpdate({ userId: user.id }, { $set: { correctStreak: 0 } });
        await interaction.editReply({
          content: `Incorrect! The correct answer was **${selected.correct}**.\nYour streak has been reset.`,
          embeds: [],
          components: [],
          files: []
        });
      }
    } catch (err) {
      console.error('❌ Error handling battle button:', err);
      return safeReply(interaction, { content: 'An error occurred processing your answer.' });
    }
  }

  /* Universal simple pager (kept as-is) */
  const navPattern = /^(first|prev|next|last)$/;
  if (navPattern.test(customId || '')) {
    const pageData = interaction.message.embeds?.[0]?.footer?.text?.match(/Page (\d+)\/(\d+)/);
    if (!pageData) return;

    let [, currentPage, totalPages] = pageData.map(Number);
    if (customId === 'first') currentPage = 1;
    if (customId === 'prev') currentPage = Math.max(1, currentPage - 1);
    if (customId === 'next') currentPage = Math.min(totalPages, currentPage + 1);
    if (customId === 'last') currentPage = totalPages;

    const updatedEmbed = JSON.parse(JSON.stringify(interaction.message.embeds[0]));
    updatedEmbed.footer.text = `Page ${currentPage}/${totalPages}`;
    updatedEmbed.description = `This is page ${currentPage}.`;

    return interaction.update({ embeds: [updatedEmbed] });
  }

  /* 🛒 Stall Section (FIXED: null-safe owner check + proper component ack) */
  const { stallPreviewFilters } = require('../utils/cache');
  const stallPreview = require('../commands/global/subcommands/stallpreview');
  const stallPattern = /^(stall_first|stall_prev|stall_next|stall_last)$/;

  if (stallPattern.test(customId || '')) {
    const msg = await getSourceMessage(interaction);
    if (!msg) {
      return safeReply(interaction, { content: '⚠️ This stall preview expired.', flags: 1 << 6 });
    }

    if (!isOwnerOfMessage(interaction)) {
      return safeReply(interaction, { content: "You can't use buttons for someone else’s command.", flags: 1 << 6 });
    }
    try {
      await autoDefer(interaction, 'update'); // deferUpdate once

      const embed = msg.embeds?.[0];
      const match = embed?.title?.match(/Page (\d+)\/(\d+)/);
      if (!match || match.length < 3) {
        return interaction.editReply({ content: '⚠️ Could not read current page.', components: [] });
      }

      let [, currentPage, totalPages] = match.map(Number);
      if (customId === 'stall_first') currentPage = 1;
      if (customId === 'stall_prev') currentPage = Math.max(1, currentPage - 1);
      if (customId === 'stall_next') currentPage = Math.min(totalPages, currentPage + 1);
      if (customId === 'stall_last') currentPage = totalPages;

      const previousFilters = stallPreviewFilters.get(msg.id) || {};
      return await stallPreview(interaction, { ...previousFilters, page: currentPage, delivery: 'update' });
    } catch (err) {
      console.error('❌ Failed to navigate stall:', err);
      return interaction.editReply({ content: '⚠️ Could not update stall preview.', components: [] });
    }
  }

  /* ⬇️ Template select menu (FIXED: use deferUpdate, not deferReply) */
  if (customId === 'select_template') {
    await autoDefer(interaction, 'update'); // component ack

    const UserRecord = require('../models/UserRecord');
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

    return interaction.editReply({
      content: `You bought **${template.name}** for ${template.price.toLocaleString()} Sopop!`,
    });
  }

  /* 🎵 Rehearsal pick buttons (minor hardening) */
  if (customId?.startsWith('rehearsal')) {
    const msg = await getSourceMessage(interaction);
    if (!msg) {
      return safeReply(interaction, { content: '⚠️ This interaction expired.', flags: 1 << 6 });
    }
    if (!isOwnerOfMessage(interaction)) {
      return safeReply(interaction, { content: 'These buttons are not yours.', flags: 1 << 6 });
    }

    await autoDefer(interaction, 'update'); // ack

    const index = parseInt(customId.split('_')[1], 10);
    const userId = interaction.user.id;

    const { EmbedBuilder } = require('discord.js');
    const UserInventory = require('../models/UserInventory');
    const UserRecord = require('../models/UserRecord');
    const giveCurrency = require('../utils/giveCurrency');

    const cards = interaction.client.cache?.rehearsal?.[userId];
    if (!cards || cards.length < 3) {
      return safeReply(interaction, { content: 'Rehearsal session not found or expired.', flags: 1 << 6 });
    }
    const selected = cards[index];
    const sopop = Math.random() < 0.4 ? (Math.random() < 0.75 ? 1 : 2) : 0;
    await giveCurrency(userId, { sopop });

    let inv = await UserInventory.findOne({ userId });
    if (!inv) inv = await UserInventory.create({ userId, cards: [] });

    const existing = inv.cards.find(c => c.cardCode === selected.cardCode);
    let copies = 1;
    if (existing) { existing.quantity += 1; copies = existing.quantity; }
    else { inv.cards.push({ cardCode: selected.cardCode, quantity: 1 }); }
    await inv.save();

    await UserRecord.create({
      userId,
      type: 'rehearsal',
      detail: `Chose ${selected.name} (${selected.cardCode}) [${selected.rarity}]`
    });

    const imageSource = selected.localImagePath
      ? `attachment://${selected._id || 'preview'}.png`
      : selected.discordPermalinkImage || selected.imgurImageLink;

    const resultEmbed = new EmbedBuilder()
      .setTitle(`You chose: ${selected.name}`)
      .setDescription([
        `**Rarity:** ${selected.rarity}`,
        `**Name:** ${selected.name}`,
        ...(selected.category?.toLowerCase() === 'kpop' ? [`**Era:** ${selected.era}`] : []),
        `**Group:** ${selected.group}`,
        `**Code:** \`${selected.cardCode}\``,
        `**Copies Owned:** ${copies}`,
        `\n__Reward__:\n${sopop ? `• <:ehx_sopop:1389584273337618542> **${sopop}** Sopop` : '• <:ehx_sopop:1389584273337618542> 0 Sopop'}`
      ].join('\n'))
      .setImage(imageSource)
      .setColor('#FFD700');

    const imageAttachment = selected.localImagePath
      ? new AttachmentBuilder(selected.localImagePath, { name: `${selected._id || 'preview'}.png` })
      : null;

    await interaction.editReply({
      embeds: [resultEmbed],
      components: [],
      files: imageAttachment ? [imageAttachment] : [],
    });
  }

  /* 📇 Index pager (unchanged, just consolidated imports) */
  interaction.client.cache ??= {};
  interaction.client.cache.indexSessions ??= {};

  const m = /^index:(first|prev|next|last|copy)$/.exec(customId || '');
  if (m) {
    const action = m[1];
    const msgId = interaction.message?.id;
    const session = interaction.client.cache.indexSessions[msgId];

    if (!session) {
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({ content: '⚠️ This index view expired. Run /index again.', flags: 1 << 6 }).catch(()=>{});
      }
      return;
    }
    const ownerId = interaction.message?.interaction?.user?.id;
    if (ownerId && interaction.user.id !== ownerId) {
      return interaction.reply({ content: "These buttons aren't yours.", flags: 1 << 6 }).catch(()=>{});
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
      const eraPart = card.category === 'kpop' && card.era ? ` | Era: ${card.era}` : '';
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
    if (!interaction.replied && !interaction.deferred) {
      await interaction.update({ embeds: [embed], components: [row] }).catch(e => console.warn('index update fail:', e.message));
    } else {
      await interaction.editReply({ embeds: [embed], components: [row] }).catch(e => console.warn('index edit fail:', e.message));
    }
    return;
  }

  /* Showcase (unchanged) */
  const showcasePattern = /^(show_first|show_prev|show_next|show_last)$/;
  if (showcasePattern.test(customId || '')) {
    const userId = interaction.user.id;
    const showcasePages = interaction.client.cache?.showcase?.[userId];

    if (!showcasePages?.length) {
      return interaction.update({
        content: 'Showcase session expired or not found.',
        embeds: [],
        components: []
      });
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

    return interaction.update({
      embeds: [page.embed],
      components: [interaction.message.components[0]],
      files: page.attachment ? [page.attachment] : []
    });
  }

 // LIST BUTTONS 

  if (interaction.isButton() && interaction.customId?.startsWith('listclaim:')) {
  // ACK the button quickly
  if (!interaction.deferred && !interaction.replied) {
    try { await interaction.deferUpdate(); } catch {}
  }

  const [, setId, idxStr] = interaction.customId.split(':');
  const idx = parseInt(idxStr, 10);
  const userId = interaction.user.id;
  const now = new Date();

  // Atomically claim: set exists, not expired, slot idx unclaimed, user hasn't claimed another
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
    // Either already claimed, expired, or you already claimed one
    try {
      await interaction.followUp({
        content: 'That slot is unavailable or you’ve already claimed one in this list.',
        ephemeral: !!interaction.guildId // ephemerals don't exist in pure DMs
      });
    } catch {}
    return;
  }

  const slot = set.slots.find(s => s.idx === idx);
  if (!slot) {
    try {
      await interaction.followUp({ content: '❌ Could not locate that slot.', ephemeral: !!interaction.guildId });
    } catch {}
    return;
  }

  const card = await Card.findById(slot.cardId);
  if (!card) {
    try {
      await interaction.followUp({ content: '❌ The card for that slot no longer exists.', ephemeral: !!interaction.guildId });
    } catch {}
    return;
  }
  // Grant inventory (same as /pull)
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

  // Reveal to claimer (ephemeral in guilds, normal in DMs)
  const stars = generateStars({ rarity: card.rarity, overrideEmoji: card.emoji || '<:fullstar:1387609456824680528>' });
  const imageSource = card.localImagePath
    ? `attachment://${card._id}.png`
    : (card.discordPermalinkImage || card.imgurImageLink);
  const files = card.localImagePath ? [new AttachmentBuilder(card.localImagePath, { name: `${card._id}.png` })] : [];

  try {
    await interaction.followUp({
      ephemeral: !!interaction.guildId, // DM-safe: false in DMs
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

  // Update the original message: disable this button; if all claimed, mark closed
  try {
    const msg = interaction.message?.id
      ? interaction.message
      : await (await interaction.client.channels.fetch(set.channelId)).messages.fetch(set.messageId);

    const rows = msg.components.map(row => {
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

    const allClaimed = set.slots.every(s => !!s.claimedBy);
    const embed0 = msg.embeds?.[0];
    const newTitle = allClaimed ? 'Mystery List — all claimed' : (embed0?.title || 'Mystery Cards List');
    const updatedEmbed = embed0 ? EmbedBuilder.from(embed0).setTitle(newTitle) : new EmbedBuilder().setTitle(newTitle);

    await msg.edit({ embeds: [updatedEmbed], components: rows });
  } catch (e) {
    console.warn('listclaim: failed to update message:', e.message);
  }
}
};