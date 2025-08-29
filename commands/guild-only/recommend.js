require('dotenv').config();
const {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ThreadAutoArchiveDuration
} = require('discord.js');

const { safeReply } = require('../../utils/safeReply');
const RecommendSettings = require('../../models/RecommendSettings');
const RecommendSubmission = require('../../models/RecommendSubmission');

const COUNT_STATUSES = ['pending', 'approved', 'posted'];

function normalizeEmoji(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!/[0-9]/.test(s)) return s;                 // unicode
  const m = s.match(/<?a?:?([\w~]+)?:?(\d{5,})>?/);
  if (m?.[2]) return m[2];                        // id
  if (/^\d{5,}$/.test(s)) return s;               // raw id
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recommend')
    .setDescription('Submit or configure recommendations')

    // /recommend submit
    .addSubcommand(sub =>
      sub.setName('submit')
        .setDescription('Submit a recommendation (name + group)')
        .addStringOption(o => o.setName('name').setDescription('Name').setRequired(true))
        .addStringOption(o => o.setName('group').setDescription('Group').setRequired(true))
    )

    // /recommend set
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Configure destination, logging and behavior')
        .setDefaultMemberPermissions('0')
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
    )

    // /recommend reset
    .addSubcommand(sub =>
      sub.setName('reset')
        .setDescription('Admin: reset 1–3 submissions for a user (per thread)')
        .setDefaultMemberPermissions('0')
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

    if (sub === 'submit') return submit(interaction);
    if (sub === 'set') {
      // your custom auth (kept)
      if (!interaction.member.roles.cache.has(process.env.MAIN_BYPASS_ID)) {
        return safeReply(interaction, { content: 'You do not have permission to use this command.' });
      }
      return setConfig(interaction);
    }
    if (sub === 'reset') {
      if (!interaction.member.roles.cache.has(process.env.MAIN_BYPASS_ID)) {
        return safeReply(interaction, { content: 'You do not have permission to use this command.' });
      }
      return resetUser(interaction);
    }
  }
};

// -------- submit
async function submit(interaction) {
  const guildId = interaction.guildId;
  const userId  = interaction.user.id;
  const name    = interaction.options.getString('name', true);
  const group   = interaction.options.getString('group', true);

  const settings = await RecommendSettings.findOne({ guildId });
  if (!settings || !settings.threadId) {
    return safeReply(interaction, { content: 'Recommendations not configured. Ask an admin to run `/recommend set`.', flags: 1 << 6 });
  }
  if (!settings.active) {
    return safeReply(interaction, { content: 'Recommendations are currently **disabled**.', flags: 1 << 6 });
  }

  // role-gated: if list is non-empty, user must have at least one listed role
  if (Array.isArray(settings.allowedRoleIds) && settings.allowedRoleIds.length > 0) {
    const hasRole = interaction.member?.roles?.cache?.some(r => settings.allowedRoleIds.includes(r.id));
    if (!hasRole) {
      return safeReply(interaction, {
        content: 'You do not have permission to submit recommendations.',
        flags: 1 << 6
      });
    }
  }

  // cap: max 3 per user per thread (pending/approved/posted)
  const MAX = 3;
  const existing = await RecommendSubmission.countDocuments({
    guildId,
    userId,
    threadId: settings.threadId,
    status: { $in: COUNT_STATUSES }
  });
  if (existing >= MAX) {
    return safeReply(interaction, {
      content: `You’ve reached the limit of **${MAX}** active submissions for that thread.`,
      flags: 1 << 6
    });
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
        return safeReply(interaction, { content: `Slow down, try again in **${msg}**.`, flags: 1 << 6 });
      }
    }
  }

  // create submission
  const needsApproval = !!settings.approvalRequired;
  const sub = await RecommendSubmission.create({
    guildId, userId, threadId: settings.threadId, name, group,
    status: needsApproval ? 'pending' : 'posted'
  });

  if (needsApproval) {
    if (!settings.modChannelId) {
      return safeReply(interaction, { content: 'Approval required but no mod channel set. Ask an admin to run `/recommend set`.', flags: 1 << 6 });
    }
    const modCh = await interaction.client.channels.fetch(settings.modChannelId).catch(() => null);
    if (!modCh?.isTextBased()) {
      return safeReply(interaction, { content: 'Cannot access the configured mod channel.', flags: 1 << 6 });
    }

    const embed = new EmbedBuilder()
      .setTitle('New Recommendation (Pending Approval)')
      .setColor(0xFEE75C)
      .addFields(
        { name: 'Name', value: name, inline: true },
        { name: 'Group', value: group, inline: true },
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

    return safeReply(interaction, { content: 'Submitted for **mod approval**. Thanks!', flags: 1 << 6 });
  }

  // auto-post when no approval required
  const post = await postToThread(interaction, settings, sub);
  if (!post.ok) return safeReply(interaction, { content: post.error, flags: 1 << 6 });

  await RecommendSubmission.updateOne({ _id: sub._id }, { status: 'posted', postedMessageId: post.messageId });

  return safeReply(interaction, { content: `Posted in <#${settings.threadId}>.`, flags: 1 << 6 });
}

// -------- set
async function setConfig(interaction) {
  const guildId = interaction.guildId;
  let settings = await RecommendSettings.findOne({ guildId });
  if (!settings) settings = new RecommendSettings({ guildId });

  const thread      = interaction.options.getChannel('thread');
  const modChannel  = interaction.options.getChannel('mod_channel');
  const reactionStr = interaction.options.getString('reaction');
  const cooldown    = interaction.options.getInteger('cooldown');
  const active      = interaction.options.getBoolean('active');
  const requireAppr = interaction.options.getBoolean('require_approval');

  const addRole    = interaction.options.getRole('add_role');
  const removeRole = interaction.options.getRole('remove_role');
  const clearRoles = interaction.options.getBoolean('clear_roles');

  // ---- Thread selection / creation (robust) ----
  if (!thread && interaction.channel?.isThread?.()) {
    // run inside a thread → use here
    settings.threadId = interaction.channel.id;
  } else if (thread?.isThread?.()) {
    // picked an existing thread
    settings.threadId = thread.id;
  } else if (thread && (thread.type === ChannelType.GuildText || thread.type === ChannelType.GuildAnnouncement)) {
    // picked a text/announcement channel → create a public thread there
    try {
      const created = await thread.threads.create({
        name: 'recommendations',
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek, // 7 days
        reason: 'Recommend destination thread'
      });
      settings.threadId = created.id;
    } catch (e) {
      return safeReply(interaction, { content: `Failed to create a thread in ${thread}.`, flags: 1 << 6 });
    }
  } else if (thread && thread.type === ChannelType.GuildForum) {
    // picked a forum channel → create a forum post (thread)
    try {
      const created = await thread.threads.create({
        name: 'Recommendations',
        message: { content: 'Thread created for recommendation submissions.' },
        reason: 'Recommend destination thread (forum)'
      });
      settings.threadId = created.id;
    } catch (e) {
      return safeReply(interaction, { content: `Failed to create a forum post in ${thread}.`, flags: 1 << 6 });
    }
  } else if (thread) {
    // some other type
    return safeReply(interaction, {
      content: 'Please choose a **thread** or a **channel** where I can create one (Text / Announcement / Forum).',
      flags: 1 << 6
    });
  } else if (!settings.threadId) {
    // no option, not in a thread, and nothing stored yet
    return safeReply(interaction, { content: 'Please choose a thread (or run this inside the target thread).', flags: 1 << 6 });
  }

  // ---- Mod channel, reaction, flags, roles (unchanged) ----
  if (modChannel) {
    if (!modChannel.isTextBased?.()) return safeReply(interaction, { content: 'Pick a text/announcement channel for `mod_channel`.', flags: 1 << 6 });
    settings.modChannelId = modChannel.id;
  }
  if (reactionStr) {
    const ok = normalizeEmoji(reactionStr);
    if (!ok) return safeReply(interaction, { content: 'Invalid reaction. Use unicode emoji or `<:name:id>`.', flags: 1 << 6 });
    settings.reaction = reactionStr;
  }
  if (typeof cooldown === 'number') settings.cooldownSeconds = Math.max(0, cooldown);
  if (typeof active === 'boolean') settings.active = active;
  if (typeof requireAppr === 'boolean') settings.approvalRequired = requireAppr;

  // role list management
  if (clearRoles) settings.allowedRoleIds = [];
  if (addRole) {
    if (!settings.allowedRoleIds.includes(addRole.id)) settings.allowedRoleIds.push(addRole.id);
  }
  if (removeRole) {
    settings.allowedRoleIds = settings.allowedRoleIds.filter(id => id !== removeRole.id);
  }

  await settings.save();

  const parts = [];
  if (settings.threadId) parts.push(`Thread: <#${settings.threadId}>`);
  if (settings.modChannelId) parts.push(`Mod Channel: <#${settings.modChannelId}>`);
  parts.push(`Active: **${settings.active ? 'Yes' : 'No'}**`);
  parts.push(`Require Approval: **${settings.approvalRequired ? 'Yes' : 'No'}**`);
  parts.push(`Cooldown: **${settings.cooldownSeconds}s**`);
  parts.push(`Reaction: ${settings.reaction || '<:e_heart:1410767827857571961>'}`);
  parts.push(`Allowed roles: ${settings.allowedRoleIds.length ? settings.allowedRoleIds.map(id => `<@&${id}>`).join(', ') : '_none (everyone)_'}`
  );

  return safeReply(interaction, { content: `Settings updated:\n${parts.join('\n')}`, flags: 1 << 6 });
}

// -------- reset (supports posted + optional delete)
async function resetUser(interaction) {
  const guildId      = interaction.guildId;
  const targetUser   = interaction.options.getUser('user', true);
  const amount       = interaction.options.getInteger('amount', true);
  const threadOpt    = interaction.options.getChannel('thread');
  const deletePosted = interaction.options.getBoolean('delete_posted') || false;

  const settings = await RecommendSettings.findOne({ guildId });
  if (!settings || !(settings.threadId || threadOpt)) {
    return safeReply(interaction, { content: 'No thread configured. Use `/recommend set` or pass `thread:`.', flags: 1 << 6 });
  }
  const threadId = threadOpt?.id || settings.threadId;

  const subs = await RecommendSubmission.find({
    guildId,
    userId: targetUser.id,
    threadId,
    status: { $in: COUNT_STATUSES }
  }).sort({ createdAt: -1 }).limit(amount);

  if (!subs.length) {
    return safeReply(interaction, { content: `No active submissions found for <@${targetUser.id}> in <#${threadId}>.`, flags: 1 << 6 });
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
    // if posted and delete flag set, delete thread message
    if (deletePosted && s.status === 'posted' && s.postedMessageId) {
      try {
        const th = await interaction.client.channels.fetch(threadId).catch(() => null);
        if (th?.isThread?.()) {
          const m = await th.messages.fetch(s.postedMessageId).catch(() => null);
          if (m) await m.delete().catch(() => {});
        }
      } catch {}
    }
    s.status = 'cleared'; // free the slot
    await s.save();
    cleared++;
  }

  return safeReply(interaction, {
    content: `Cleared **${cleared}** submission(s) for <@${targetUser.id}> in <#${threadId}>.${deletePosted ? ' (Posted messages deleted.)' : ''}`,
    flags: 1 << 6
  });
}

// posting helper
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
      )
      .setTimestamp();

    const sent = await thread.send({ embeds: [embed] });

    const rx = settings.reaction || '<:e_heart:1410767827857571961>';
    try { await sent.react(rx); } catch { try { await sent.react('<:e_heart:1410767827857571961>'); } catch {} }

    return { ok: true, messageId: sent.id, url: sent.url };
  } catch (e) {
    console.error('[recommend] postToThread error:', e);
    return { ok: false, error: 'Failed to post in the configured thread.' };
  }
}
