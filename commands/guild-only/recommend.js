// commands/global/recommend.js
require('dotenv').config();
const {
  SlashCommandBuilder,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration
} = require('discord.js');

const { safeReply } = require('../../utils/safeReply');
const RecommendSettings   = require('../../models/RecommendSettings');
const RecommendSubmission = require('../../models/RecommendSubmission');

// Statuses that count toward the per-user cap
const COUNT_STATUSES = ['pending', 'approved', 'posted'];

// ✅ Category must be one of these (required in modal)
const ALLOWED_CATEGORIES = [
  'boy group',
  'girl group',
  'game character',
  'anime character',
  'actor',
  'actress',
];

// ---------- helpers ----------
function normalizeEmoji(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!/[0-9]/.test(s)) return s;        // unicode
  const m = s.match(/<?a?:?([\w~]+)?:?(\d{5,})>?/);
  if (m?.[2]) return m[2];               // custom emoji id
  if (/^\d{5,}$/.test(s)) return s;      // raw id
  return null;
}

function needPermsText(ch, missing) {
  return `I’m missing these permissions in ${ch}:\n• ` + missing.join('\n• ');
}

async function ensureThreadable(channel, clientUserId) {
  const perms = channel.permissionsFor(clientUserId);
  if (!perms) return { ok: false, error: `I cannot read permissions in ${channel}.` };

  const missing = [];
  if (!perms.has('ViewChannel')) missing.push('ViewChannel');
  if (!perms.has('SendMessages')) missing.push('SendMessages');
  if (!perms.has('CreatePublicThreads')) missing.push('CreatePublicThreads');
  if (!perms.has('SendMessagesInThreads')) missing.push('SendMessagesInThreads');
  if (channel.type === ChannelType.GuildAnnouncement && !perms.has('ManageThreads')) {
    missing.push('ManageThreads (announcement threads)');
  }

  if (missing.length) return { ok: false, error: needPermsText(channel, missing) };
  return { ok: true };
}
// ------------------------------

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recommend')
    .setDescription('Submit or configure recommendations')
    .setDMPermission(false)

    // /recommend submit → opens modal (no public fields)
    .addSubcommand(sub =>
      sub.setName('submit')
        .setDescription('Open a private form to submit a recommendation')
    )

    // /recommend set
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Configure destination, logging and behavior')
        .addChannelOption(o =>
          o.setName('thread')
            .setDescription('Pick a thread (or a channel to auto-create a thread)')
            .addChannelTypes(
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread,
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum
            )
        )
        .addChannelOption(o => o.setName('mod_channel')
          .setDescription('Mod log/approval channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption(o => o.setName('reaction').setDescription('Reaction (👍 or <:name:id>)'))
        .addIntegerOption(o => o.setName('cooldown').setDescription('Cooldown (seconds)'))
        .addBooleanOption(o => o.setName('active').setDescription('Enable/disable recommendations'))
        .addBooleanOption(o => o.setName('require_approval').setDescription('Require mod approval first?'))
        // role management
        .addRoleOption(o => o.setName('add_role').setDescription('Allow this role to use /recommend submit'))
        .addRoleOption(o => o.setName('remove_role').setDescription('Remove this role from allowed list'))
        .addBooleanOption(o => o.setName('clear_roles').setDescription('Clear the allowed role list'))
        // per-user cap (1–5 as you had)
        .addIntegerOption(o =>
          o.setName('max_per_user')
            .setDescription('Active submissions allowed per user in the thread (1–5)')
            .setMinValue(1)
            .setMaxValue(5)
        )
    )

    // /recommend reset
    .addSubcommand(sub =>
      sub.setName('reset')
        .setDescription('Admin: reset 1–3 submissions for a user (per thread)')
        .addUserOption(o => o.setName('user').setDescription('User to reset').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('How many (1–3)').setRequired(true)
          .addChoices({ name: '1', value: 1 }, { name: '2', value: 2 }, { name: '3', value: 3 }))
        .addChannelOption(o => o.setName('thread')
          .setDescription('Thread to target (defaults to configured thread)')
          .addChannelTypes(ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread))
        .addBooleanOption(o => o.setName('delete_posted').setDescription('Also delete the posted message?'))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'submit') {
      return openSubmitModal(interaction);
    }

    if (sub === 'set') {
      // 🔒 keep YOUR original permission style: MAIN_BYPASS_ID role only
      if (!interaction.member.roles.cache.has(process.env.MAIN_BYPASS_ID)) {
        return safeReply(interaction, { content: 'You do not have permission to use this command.' });
      }
      return setConfig(interaction);
    }

    if (sub === 'reset') {
      // 🔒 keep YOUR original permission style: MAIN_BYPASS_ID role only
      if (!interaction.member.roles.cache.has(process.env.MAIN_BYPASS_ID)) {
        return safeReply(interaction, { content: 'You do not have permission to use this command.' });
      }
      return resetUser(interaction);
    }
  },

  // Expose the modal submit handler so your router can call it
  onModalSubmit
};

/* -------------------- submit (modal) -------------------- */

async function openSubmitModal(interaction) {
  // Just show a modal; nothing public is posted in the channel.
  const modal = new ModalBuilder()
    .setCustomId('rec:submit')
    .setTitle('Submit a Recommendation');

  const nameInput = new TextInputBuilder()
    .setCustomId('rec_name')
    .setLabel('Name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setPlaceholder('e.g., Soobin');

  const groupInput = new TextInputBuilder()
    .setCustomId('rec_group')
    .setLabel('Group')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setPlaceholder('e.g., TXT');

  const catInput = new TextInputBuilder()
    .setCustomId('rec_category')
    .setLabel('Category | boy group / girl group / game character / anime character / actor / actress')
    .setStyle(TextInputStyle.Short)
    .setRequired(true) // ✅ required
    .setMaxLength(32)
    .setPlaceholder('boy group');

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(groupInput),
    new ActionRowBuilder().addComponents(catInput),
  );

  return interaction.showModal(modal);
}

async function onModalSubmit(interaction) {
  if (interaction.customId !== 'rec:submit') return;

  const guildId = interaction.guildId;
  if (!guildId) {
    return safeReply(interaction, { content: 'This command only works in a server.' });
  }

  const name      = interaction.fields.getTextInputValue('rec_name')?.trim();
  const group     = interaction.fields.getTextInputValue('rec_group')?.trim();
  const categoryR = interaction.fields.getTextInputValue('rec_category')?.trim();

  if (!name || !group || !categoryR) {
    return safeReply(interaction, { content: 'Please fill **Name**, **Group**, and **Category**.' });
  }

  // ✅ enforce allowed categories (case-insensitive)
  const category = categoryR.toLowerCase();
  if (!ALLOWED_CATEGORIES.includes(category)) {
    return safeReply(interaction, {
      content: `Invalid category.\nAllowed: ${ALLOWED_CATEGORIES.join(', ')}`,
      ephemeral: true
    });
  }

  const userId = interaction.user.id;
  const settings = await RecommendSettings.findOne({ guildId });
  if (!settings || !settings.threadId) {
    return safeReply(interaction, { content: 'Recommendations not configured. Ask an admin to run `/recommend set`.' });
  }
  if (!settings.active) {
    return safeReply(interaction, { content: 'Recommendations are currently **disabled**.' });
  }

  // role-gate (if any roles specified)
  if (Array.isArray(settings.allowedRoleIds) && settings.allowedRoleIds.length > 0) {
    const hasRole = interaction.member?.roles?.cache?.some(r => settings.allowedRoleIds.includes(r.id));
    if (!hasRole) {
      return safeReply(interaction, { content: 'You do not have permission to submit recommendations.' });
    }
  }

  // per-user cap (default 3)
  const MAX = Math.max(1, settings.maxPerUser || 3);
  const existing = await RecommendSubmission.countDocuments({
    guildId, userId, threadId: settings.threadId, status: { $in: COUNT_STATUSES }
  });
  if (existing >= MAX) {
    return safeReply(interaction, { content: `You’ve reached the limit of **${MAX}** active submissions for that thread.` });
  }

  // cooldown
  const cd = Math.max(0, settings.cooldownSeconds || 0);
  if (cd > 0) {
    const last = await RecommendSubmission.findOne({ guildId, userId }).sort({ createdAt: -1 });
    if (last) {
      const delta = Date.now() - last.createdAt.getTime();
      const remain = cd * 1000 - delta;
      if (remain > 0) {
        const s = Math.ceil(remain / 1000);
        const msg = s < 60 ? `${s}s` : `${Math.floor(s/60)}m${s%60 ? ' '+(s%60)+'s' : ''}`;
        return safeReply(interaction, { content: `Slow down, try again in **${msg}**.` });
      }
    }
  }

  // create submission
  const needsApproval = !!settings.approvalRequired;
  const sub = await RecommendSubmission.create({
    guildId, userId, threadId: settings.threadId, name, group, category,
    status: needsApproval ? 'pending' : 'posted'
  });

  if (needsApproval) {
    if (!settings.modChannelId) {
      return safeReply(interaction, { content: 'Approval required but no mod channel set. Ask an admin to run `/recommend set`.' });
    }
    const modCh = await interaction.client.channels.fetch(settings.modChannelId).catch(() => null);
    if (!modCh?.isTextBased()) {
      return safeReply(interaction, { content: 'Cannot access the configured mod channel.' });
    }

    const embed = new EmbedBuilder()
      .setTitle('New Recommendation (Pending Approval)')
      .setColor(0xFEE75C)
      .addFields(
        { name: 'Name', value: name, inline: true },
        { name: 'Group', value: group, inline: true },
        { name: 'Category', value: category, inline: true },
        { name: 'Requested by', value: `<@${userId}>`, inline: false }
      )
      .setFooter({ text: `Submission ID: ${sub._id}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rec:approve:${sub._id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`rec:reject:${sub._id}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
    );

    const sent = await modCh.send({ embeds: [embed], components: [row] });
    sub.modMessageId = sent.id;
    await sub.save();

    return safeReply(interaction, { content: 'Submitted for **mod approval**. Thanks!' });
  }

  // auto-post when no approval required
  const post = await postToThread(interaction, settings, sub);
  if (!post.ok) return safeReply(interaction, { content: post.error });

  await RecommendSubmission.updateOne({ _id: sub._id }, { status: 'posted', postedMessageId: post.messageId });
  return safeReply(interaction, { content: `Posted in <#${settings.threadId}>.` });
}

/* -------------------- set -------------------- */

async function setConfig(interaction) {
  const guildId = interaction.guildId;
  let settings = await RecommendSettings.findOne({ guildId });
  if (!settings) settings = new RecommendSettings({ guildId });

  const picked      = interaction.options.getChannel('thread');
  const modChannel  = interaction.options.getChannel('mod_channel');
  const reactionStr = interaction.options.getString('reaction');
  const cooldown    = interaction.options.getInteger('cooldown');
  const active      = interaction.options.getBoolean('active');
  const requireAppr = interaction.options.getBoolean('require_approval');
  const maxPerUser  = interaction.options.getInteger('max_per_user');

  const addRole    = interaction.options.getRole('add_role');
  const removeRole = interaction.options.getRole('remove_role');
  const clearRoles = interaction.options.getBoolean('clear_roles');

  const me = interaction.client.user.id;

  // Thread selection / creation
  if (!picked && interaction.channel?.isThread?.()) {
    settings.threadId = interaction.channel.id;
  } else if (picked?.isThread?.()) {
    settings.threadId = picked.id;
  } else if (picked && (picked.type === ChannelType.GuildText || picked.type === ChannelType.GuildAnnouncement)) {
    const ok = await ensureThreadable(picked, me);
    if (!ok.ok) return safeReply(interaction, { content: ok.error });
    try {
      const created = await picked.threads.create({
        name: 'recommendations',
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: 'Recommend destination thread'
      });
      settings.threadId = created.id;
    } catch (e) {
      return safeReply(interaction, { content: `Failed to create a thread in ${picked}: ${e.message || e}` });
    }
  } else if (picked && picked.type === ChannelType.GuildForum) {
    const ok = await ensureThreadable(picked, me);
    if (!ok.ok) return safeReply(interaction, { content: ok.error });
    try {
      const created = await picked.threads.create({
        name: 'Recommendations',
        message: { content: 'Thread created for recommendation submissions.' },
        reason: 'Recommend destination thread (forum)'
      });
      settings.threadId = created.id;
    } catch (e) {
      return safeReply(interaction, { content: `Failed to create a forum thread in ${picked}: ${e.message || e}` });
    }
  } else if (picked) {
    return safeReply(interaction, {
      content: `Please choose a **thread** or a **thread-capable channel** (Text / Announcement / Forum). Got unsupported type: **${picked.type}**.`,
      
    });
  } else if (!settings.threadId) {
    return safeReply(interaction, { content: 'Pick a thread (or run this inside the destination thread).' });
  }

  // Other settings
  if (modChannel) {
    if (!modChannel.isTextBased?.()) return safeReply(interaction, { content: 'Pick a text/announcement channel for `mod_channel`.' });
    settings.modChannelId = modChannel.id;
  }
  if (reactionStr) {
    const ok = normalizeEmoji(reactionStr);
    if (!ok) return safeReply(interaction, { content: 'Invalid reaction. Use unicode emoji or `<:name:id>`.' });
    settings.reaction = reactionStr;
  }
  if (typeof cooldown === 'number') settings.cooldownSeconds = Math.max(0, cooldown);
  if (typeof active === 'boolean') settings.active = active;
  if (typeof requireAppr === 'boolean') settings.approvalRequired = requireAppr;
  if (typeof maxPerUser === 'number') settings.maxPerUser = Math.min(5, Math.max(1, maxPerUser));

  if (clearRoles) settings.allowedRoleIds = [];
  if (addRole && !settings.allowedRoleIds.includes(addRole.id)) settings.allowedRoleIds.push(addRole.id);
  if (removeRole) settings.allowedRoleIds = settings.allowedRoleIds.filter(id => id !== removeRole.id);

  await settings.save();

  const parts = [];
  if (settings.threadId) parts.push(`Thread: <#${settings.threadId}>`);
  if (settings.modChannelId) parts.push(`Mod Channel: <#${settings.modChannelId}>`);
  parts.push(`Active: **${settings.active ? 'Yes' : 'No'}**`);
  parts.push(`Require Approval: **${settings.approvalRequired ? 'Yes' : 'No'}**`);
  parts.push(`Cooldown: **${settings.cooldownSeconds || 0}s**`);
  parts.push(`Max per user: **${settings.maxPerUser || 3}**`);
  parts.push(`Reaction: ${settings.reaction || '👍'}`);
  parts.push(`Allowed roles: ${settings.allowedRoleIds?.length ? settings.allowedRoleIds.map(id => `<@&${id}>`).join(', ') : '_none (everyone)_'}`);

  return safeReply(interaction, { content: `Settings updated:\n${parts.join('\n')}` });
}

/* -------------------- reset -------------------- */

async function resetUser(interaction) {
  const guildId      = interaction.guildId;
  const targetUser   = interaction.options.getUser('user', true);
  const amount       = interaction.options.getInteger('amount', true);
  const threadOpt    = interaction.options.getChannel('thread');
  const deletePosted = interaction.options.getBoolean('delete_posted') || false;

  const settings = await RecommendSettings.findOne({ guildId });
  if (!settings || !(settings.threadId || threadOpt)) {
    return safeReply(interaction, { content: 'No thread configured. Use `/recommend set` or pass `thread:`.' });
  }
  const threadId = threadOpt?.id || settings.threadId;

  const subs = await RecommendSubmission.find({
    guildId,
    userId: targetUser.id,
    threadId,
    status: { $in: COUNT_STATUSES }
  }).sort({ createdAt: -1 }).limit(amount);

  if (!subs.length) {
    return safeReply(interaction, { content: `No active submissions found for <@${targetUser.id}> in <#${threadId}>.` });
  }

  let cleared = 0;
  for (const s of subs) {
    // remove buttons on mod card
    if (s.modMessageId && settings.modChannelId) {
      try {
        const ch = await interaction.client.channels.fetch(settings.modChannelId);
        if (ch?.isTextBased()) {
          const msg = await ch.messages.fetch(s.modMessageId).catch(() => null);
          if (msg) await msg.edit({ components: [] });
        }
      } catch {}
    }
    // optionally delete the posted thread message
    if (deletePosted && s.status === 'posted' && s.postedMessageId) {
      try {
        const th = await interaction.client.channels.fetch(threadId).catch(() => null);
        if (th?.isThread?.()) {
          const m = await th.messages.fetch(s.postedMessageId).catch(() => null);
          if (m) await m.delete().catch(() => {});
        }
      } catch {}
    }
    s.status = 'cleared';
    await s.save();
    cleared++;
  }

  return safeReply(interaction, {
    content: `Cleared **${cleared}** submission(s) for <@${targetUser.id}> in <#${threadId}>.${deletePosted ? ' (Posted messages deleted.)' : ''}`,
  });
}

/* -------------------- helper: post -------------------- */

async function postToThread(interaction, settings, sub) {
  try {
    const thread = await interaction.client.channels.fetch(settings.threadId).catch(() => null);
    if (!thread?.isThread?.()) {
      return { ok: false, error: 'Configured thread not accessible. Ask an admin to re-run `/recommend set`.' };
    }

    const embed = new EmbedBuilder()
      .setTitle('New Recommendation')
      .setColor(0x5865F2)
      .addFields(
        { name: 'Name',  value: sub.name,  inline: true },
        { name: 'Group', value: sub.group, inline: true },
        { name: 'Category', value: sub.category, inline: true },
        
      )
      .setTimestamp();

    const sent = await thread.send({ embeds: [embed] });
    const rx = settings.reaction || '👍';
    try { await sent.react(rx); } catch { try { await sent.react('👍'); } catch {} }

    return { ok: true, messageId: sent.id, url: sent.url };
  } catch (e) {
    console.error('[recommend] postToThread error:', e);
    return { ok: false, error: 'Failed to post in the configured thread.' };
  }
}
