// commands/global/indexprivacy.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');
const IndexPrivacy = require('../../models/IndexPrivacy');

// ---------- constants ----------
const YES = /^(yes|true|1|on)$/i;
const BUCKETS = ['cards', 'groups', 'names', 'eras'];
const DEFAULT_PAGE_SIZE = 20; // items per page (keeps field <= 1024 chars)

// ---------- helpers ----------
function parseList(s) {
  return (s || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}
function toTitle(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function uniqCI(list) {
  const seen = new Set(); const out = [];
  for (const item of list) {
    const k = item.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(item); }
  }
  return out;
}
function removeCI(src, removing) {
  const rm = new Set(removing.map(x => x.toLowerCase()));
  return (src || []).filter(v => !rm.has(v.toLowerCase()));
}
function calcDelta(before = [], after = []) {
  const b = new Set(before.map(x => x.toLowerCase()));
  const a = new Set(after.map(x => x.toLowerCase()));
  return {
    added: after.filter(x => !b.has(x.toLowerCase())),
    removed: before.filter(x => !a.has(x.toLowerCase())),
  };
}
function truncate(text, max = 1024) {
  if (!text) return '';
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 3)) + '…';
}
function fmtPage(list, page, pageSize = DEFAULT_PAGE_SIZE) {
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  const start = (p - 1) * pageSize;
  const slice = list.slice(start, start + pageSize);
  const text = slice.length ? slice.map(v => `• ${v}`).join('\n') : '(none)';
  return { page: p, totalPages, text, total };
}
function buildDeltaEmbed(user, before, after, { mode }) {
  const embed = new EmbedBuilder()
    .setTitle('Index Privacy Updated')
    .setColor(after.hideAll ? 0xFF006E : 0x00C853)
    .setFooter({ text: `${user.username}` })
    .setTimestamp(new Date());

  if (before.hideAll !== after.hideAll) {
    embed.addFields({
      name: 'Privacy',
      value: `hideAll: **${after.hideAll ? 'ON' : 'OFF'}** (was ${before.hideAll ? 'ON' : 'OFF'})`,
      inline: false,
    });
  } else if (mode === 'clear') {
    embed.addFields({
      name: 'Privacy',
      value: 'All privacy lists cleared, hideAll: **OFF**',
      inline: false,
    });
  }

  for (const field of BUCKETS) {
    const { added, removed } = calcDelta(before[field], after[field]);
    if (!added.length && !removed.length && mode !== 'replace') continue;
    const blocks = [];
    if (added.length)   blocks.push(`**Added** (${added.length})\n${truncate(added.map(v => `• ${v}`).join('\n'))}`);
    if (removed.length) blocks.push(`**Removed** (${removed.length})\n${truncate(removed.map(v => `• ${v}`).join('\n'))}`);
    if (!blocks.length) continue;
    embed.addFields({ name: toTitle(field), value: blocks.join('\n\n'), inline: false });
  }

  if (!embed.data.fields?.length) {
    embed.setDescription(`Mode: **${toTitle(mode)}**\nNo list changes detected.`);
  } else {
    embed.setDescription(`Mode: **${toTitle(mode)}**\nOnly this operation’s changes are shown. Use \`/indexprivacy view\` for full policy.`);
  }
  return embed;
}

// ---------- VIEW UI (embeds + namespaced buttons) ----------
function buildViewUI({ viewer, ownerId, doc, bucket = 'cards', page = 1, pageSize = DEFAULT_PAGE_SIZE }) {
  if (!BUCKETS.includes(bucket)) bucket = 'cards';

  const lists = {
    cards:  doc.cards  || [],
    groups: doc.groups || [],
    names:  doc.names  || [],
    eras:   doc.eras   || [],
  };

  const pageInfo = fmtPage(lists[bucket], page, pageSize);

  const embed = new EmbedBuilder()
    .setTitle('Your Index Privacy')
    .setColor(doc.hideAll ? 0xFF006E : 0x2196F3)
    .setDescription(
      `hideAll: **${doc.hideAll ? 'ON' : 'OFF'}**\n` +
      `Bucket: **${toTitle(bucket)}** • Page **${pageInfo.page}/${pageInfo.totalPages}** • Items: **${lists[bucket].length}**`
    )
    .addFields({ name: `${toTitle(bucket)}`, value: truncate(pageInfo.text), inline: false })
    .setFooter({ text: `${viewer.username}` })
    .setTimestamp(new Date());

  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

  const idx = BUCKETS.indexOf(bucket);
  const prevBucket = BUCKETS[(idx - 1 + BUCKETS.length) % BUCKETS.length];
  const nextBucket = BUCKETS[(idx + 1) % BUCKETS.length];

  // Custom ID schema (pipe-separated to avoid collisions):
  // iprv|view|<ownerId>|<bucket>|<page>|<ACTION>   where ACTION ∈ {F,P,N,L,SB}
  const mkId = (b, p, action) => `iprv|view|${ownerId}|${b}|${p}|${action}`;

  const rowBuckets = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(mkId(prevBucket, 1, 'SB')).setEmoji('🗂️').setStyle(ButtonStyle.Secondary).setLabel(`< ${toTitle(prevBucket)}`),
    new ButtonBuilder().setCustomId('iprv|noop').setStyle(ButtonStyle.Secondary).setLabel(`Bucket: ${toTitle(bucket)}`).setDisabled(true),
    new ButtonBuilder().setCustomId(mkId(nextBucket, 1, 'SB')).setEmoji('🗂️').setStyle(ButtonStyle.Secondary).setLabel(`${toTitle(nextBucket)} >`),
  );

  const rowPages = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(mkId(bucket, 1, 'F')).setEmoji({ name: '⏮️' }).setStyle(ButtonStyle.Secondary).setDisabled(pageInfo.page <= 1),
    new ButtonBuilder().setCustomId(mkId(bucket, Math.max(1, pageInfo.page - 1), 'P')).setEmoji({ name: '◀️' }).setStyle(ButtonStyle.Primary).setDisabled(pageInfo.page <= 1),
    new ButtonBuilder().setCustomId(mkId(bucket, Math.min(pageInfo.totalPages, pageInfo.page + 1), 'N')).setEmoji({ name: '▶️' }).setStyle(ButtonStyle.Primary).setDisabled(pageInfo.page >= pageInfo.totalPages),
    new ButtonBuilder().setCustomId(mkId(bucket, pageInfo.totalPages, 'L')).setEmoji({ name: '⏭️' }).setStyle(ButtonStyle.Secondary).setDisabled(pageInfo.page >= pageInfo.totalPages),
    new ButtonBuilder().setCustomId(`iprv|close|${ownerId}|X`).setLabel('Close').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [rowBuckets, rowPages] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('indexprivacy')
    .setDescription('Configure who sees your /index.')
    .addSubcommand(sc =>
      sc.setName('set')
        .setDescription('Add/replace/remove/clear privacy options.')
        .addStringOption(o =>
          o.setName('mode').setDescription('How to apply changes').setRequired(true).addChoices(
            { name: 'Replace (overwrite fields)', value: 'replace' },
            { name: 'Add (append to lists)', value: 'add' },
            { name: 'Remove (from lists)', value: 'remove' },
            { name: 'Clear (reset everything)', value: 'clear' }
          )
        )
        .addStringOption(o => o.setName('hide_all').setDescription('yes | no'))
        .addStringOption(o => o.setName('cards').setDescription('Card code(s), comma-separated'))
        .addStringOption(o => o.setName('groups').setDescription('Group(s), comma-separated'))
        .addStringOption(o => o.setName('names').setDescription('Name(s), comma-separated'))
        .addStringOption(o => o.setName('eras').setDescription('Era(s), comma-separated'))
    )
    .addSubcommand(sc =>
      sc.setName('view').setDescription('View your full index privacy settings.')
    ),

  // exported helper for the button handler
  buildViewUI,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;
    let doc = await IndexPrivacy.findOne({ userId });

    if (sub === 'view') {
      if (!doc) {
        doc = new IndexPrivacy({ userId, hideAll: false, cards: [], groups: [], names: [], eras: [] });
        await doc.save();
      }
      const ui = buildViewUI({ viewer: interaction.user, ownerId: userId, doc, bucket: 'cards', page: 1 });
      return interaction.editReply(ui);
    }

    // ------ sub === 'set' ------
    const mode = interaction.options.getString('mode');
    const hideAllStr = interaction.options.getString('hide_all');
    const cards  = parseList(interaction.options.getString('cards'));
    const groups = parseList(interaction.options.getString('groups'));
    const names  = parseList(interaction.options.getString('names'));
    const eras   = parseList(interaction.options.getString('eras'));

    const before = (doc && {
      hideAll: !!doc.hideAll,
      cards: [...(doc.cards || [])],
      groups: [...(doc.groups || [])],
      names: [...(doc.names || [])],
      eras:  [...(doc.eras  || [])],
    }) || { hideAll: false, cards: [], groups: [], names: [], eras: [] };

    if (!doc) doc = new IndexPrivacy({ userId, ...before });

    if (mode === 'clear') {
      doc.hideAll = false;
      doc.cards = []; doc.groups = []; doc.names = []; doc.eras = [];
    } else {
      if (hideAllStr) doc.hideAll = YES.test(hideAllStr);
      if (mode === 'replace') {
        if (cards.length)  doc.cards  = uniqCI(cards);
        if (groups.length) doc.groups = uniqCI(groups);
        if (names.length)  doc.names  = uniqCI(names);
        if (eras.length)   doc.eras   = uniqCI(eras);
      } else if (mode === 'add') {
        if (cards.length)  doc.cards  = uniqCI([...(doc.cards || []),  ...cards]);
        if (groups.length) doc.groups = uniqCI([...(doc.groups || []), ...groups]);
        if (names.length)  doc.names  = uniqCI([...(doc.names || []),  ...names]);
        if (eras.length)   doc.eras   = uniqCI([...(doc.eras || []),   ...eras]);
      } else if (mode === 'remove') {
        if (cards.length)  doc.cards  = removeCI(doc.cards  || [], cards);
        if (groups.length) doc.groups = removeCI(doc.groups || [], groups);
        if (names.length)  doc.names  = removeCI(doc.names  || [], names);
        if (eras.length)   doc.eras   = removeCI(doc.eras   || [], eras);
      }
    }

    await doc.save();

    const deltaEmbed = buildDeltaEmbed(interaction.user, before, {
      hideAll: doc.hideAll,
      cards: doc.cards || [],
      groups: doc.groups || [],
      names: doc.names || [],
      eras: doc.eras || []
    }, { mode });

    return interaction.editReply({ embeds: [deltaEmbed] });
  }
};
