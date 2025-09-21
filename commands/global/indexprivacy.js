// commands/global/indexprivacy.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const IndexPrivacy = require('../../models/IndexPrivacy');

// ======== Config ========
const YES = /^(yes|true|1|on)$/i;
// Your requested display order:
const BUCKETS = ['groups', 'cards', 'names', 'eras'];
const DEFAULT_PAGE_SIZE = 20; // items per page

// ======== Small utilities ========
const parseList = (s) => (s || '').split(',').map(v => v.trim()).filter(Boolean);
const toTitle = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

const uniqCI = (list) => {
  const seen = new Set(); const out = [];
  for (const item of (list || [])) {
    const k = String(item).toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(String(item)); }
  }
  return out;
};
const removeCI = (src, removing) => {
  const rm = new Set((removing || []).map(x => String(x).toLowerCase()));
  return (src || []).filter(v => !rm.has(String(v).toLowerCase()));
};
const delta = (before = [], after = []) => {
  const b = new Set(before.map(x => String(x).toLowerCase()));
  const a = new Set(after.map(x => String(x).toLowerCase()));
  return {
    added:  after.filter(x => !b.has(String(x).toLowerCase())),
    removed: before.filter(x => !a.has(String(x).toLowerCase())),
  };
};
const sortCI = (arr) =>
  [...(arr || [])].sort((a, b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()));

function paginateSorted(list, page, pageSize = DEFAULT_PAGE_SIZE) {
  const sorted = sortCI(list || []);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  const slice = sorted.slice((p - 1) * pageSize, (p - 1) * pageSize + pageSize);
  return {
    page: p,
    totalPages,
    total,
    text: slice.length ? slice.map(v => `• ${v}`).join('\n') : '(none)',
    sorted,
  };
}

// ======== Embeds ========
function buildDeltaEmbed(user, before, after, mode) {
  const embed = new EmbedBuilder()
    .setTitle('Index Privacy Updated')
    .setColor(after.hideAll ? 0xFF006E : 0x00C853)
    .setFooter({ text: user.username })
    .setTimestamp();

  if (before.hideAll !== after.hideAll) {
    embed.addFields({
      name: 'Privacy',
      value: `hideAll: **${after.hideAll ? 'ON' : 'OFF'}** (was ${before.hideAll ? 'ON' : 'OFF'})`,
    });
  } else if (mode === 'clear') {
    embed.addFields({ name: 'Privacy', value: 'All lists cleared, hideAll: **OFF**' });
  }

  for (const bucket of BUCKETS) {
    const d = delta(before[bucket], after[bucket]);
    if (!d.added.length && !d.removed.length && mode !== 'replace') continue;
    const parts = [];
    if (d.added.length)   parts.push(`**Added** (${d.added.length})\n${sortCI(d.added).map(v => `• ${v}`).join('\n')}`);
    if (d.removed.length) parts.push(`**Removed** (${d.removed.length})\n${sortCI(d.removed).map(v => `• ${v}`).join('\n')}`);
    if (parts.length) embed.addFields({ name: toTitle(bucket), value: parts.join('\n\n') });
  }

  embed.setDescription(
    !embed.data.fields?.length
      ? `Mode: **${toTitle(mode)}** — no list changes.`
      : `Mode: **${toTitle(mode)}** — showing only this operation’s changes.`
  );
  return embed;
}

function buildViewUI({ viewer, ownerId, doc, bucket = BUCKETS[0], page = 1 }) {
  if (!BUCKETS.includes(bucket)) bucket = BUCKETS[0];

  const lists = {
    groups: sortCI(doc.groups || []),
    cards:  sortCI(doc.cards  || []),
    names:  sortCI(doc.names  || []),
    eras:   sortCI(doc.eras   || []),
  };

  const pageInfo = paginateSorted(lists[bucket], page);

  const embed = new EmbedBuilder()
    .setTitle('Your Index Privacy')
    .setColor(doc.hideAll ? 0xFF006E : 0x2196F3)
    .setDescription(
      `hideAll: **${doc.hideAll ? 'ON' : 'OFF'}**\n` +
      `Bucket: **${toTitle(bucket)}** • Page **${pageInfo.page}/${pageInfo.totalPages}** • Items: **${lists[bucket].length}**`
    )
    .addFields({ name: toTitle(bucket), value: pageInfo.text || '(none)' })
    .setFooter({ text: viewer.username })
    .setTimestamp();

  const idx = BUCKETS.indexOf(bucket);
  const prevBucket = BUCKETS[(idx - 1 + BUCKETS.length) % BUCKETS.length];
  const nextBucket = BUCKETS[(idx + 1) % BUCKETS.length];

  // Custom ID schema: iprv|view|<ownerId>|<bucket>|<page>|<ACTION>
  const mkId = (b, p, action) => `iprv|view|${ownerId}|${b}|${p}|${action}`;

  const rowBuckets = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(mkId(prevBucket, 1, 'SB')).setLabel(`< ${toTitle(prevBucket)}`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('iprv|noop').setLabel(`Bucket: ${toTitle(bucket)}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(mkId(nextBucket, 1, 'SB')).setLabel(`${toTitle(nextBucket)} >`).setStyle(ButtonStyle.Secondary),
  );

  const rowPages = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(mkId(bucket, 1, 'F')).setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(pageInfo.page <= 1),
    new ButtonBuilder().setCustomId(mkId(bucket, Math.max(1, pageInfo.page - 1), 'P')).setEmoji('◀️').setStyle(ButtonStyle.Primary).setDisabled(pageInfo.page <= 1),
    new ButtonBuilder().setCustomId(mkId(bucket, Math.min(pageInfo.totalPages, pageInfo.page + 1), 'N')).setEmoji('▶️').setStyle(ButtonStyle.Primary).setDisabled(pageInfo.page >= pageInfo.totalPages),
    new ButtonBuilder().setCustomId(mkId(bucket, pageInfo.totalPages, 'L')).setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(pageInfo.page >= pageInfo.totalPages),
  );

  return { embeds: [embed], components: [rowBuckets, rowPages] };
}

// ======== Command (slash + buttons handled here) ========
module.exports = {
  data: new SlashCommandBuilder()
    .setName('indexprivacy')
    .setDescription('Control privacy of your index')
    .addSubcommand(sc =>
      sc.setName('set')
        .setDescription('Add/replace/remove/clear privacy options.')
        .addStringOption(o =>
          o.setName('mode').setRequired(true).setDescription('How to apply changes')
            .addChoices(
              { name: 'Replace (overwrite)', value: 'replace' },
              { name: 'Add', value: 'add' },
              { name: 'Remove', value: 'remove' },
              { name: 'Clear all', value: 'clear' }
            )
        )
        .addStringOption(o => o.setName('hide_all').setDescription('yes | no'))
        .addStringOption(o => o.setName('groups').setDescription('Groups, comma-separated'))
        .addStringOption(o => o.setName('cards').setDescription('Card codes, comma-separated'))
        .addStringOption(o => o.setName('names').setDescription('Names, comma-separated'))
        .addStringOption(o => o.setName('eras').setDescription('Eras, comma-separated'))
    )
    .addSubcommand(sc =>
      sc.setName('view').setDescription('View your privacy settings with pagination.')
    ),

  async execute(interaction) {
    // Handle slash commands
    if (interaction.isChatInputCommand?.()) {
      await interaction.deferReply({ ephemeral: true });
      const sub = interaction.options.getSubcommand();
      const userId = interaction.user.id;

      let doc = await IndexPrivacy.findOne({ userId });
      if (!doc) {
        doc = new IndexPrivacy({ userId, hideAll: false, cards: [], groups: [], names: [], eras: [] });
        await doc.save();
      }

      if (sub === 'view') {
        const ui = buildViewUI({ viewer: interaction.user, ownerId: userId, doc, bucket: BUCKETS[0], page: 1 });
        return interaction.editReply(ui);
      }

      if (sub === 'set') {
        const mode = interaction.options.getString('mode');
        const hideAllStr = interaction.options.getString('hide_all');
        const groups = parseList(interaction.options.getString('groups'));
        const cards  = parseList(interaction.options.getString('cards'));
        const names  = parseList(interaction.options.getString('names'));
        const eras   = parseList(interaction.options.getString('eras'));

        const before = {
          hideAll: !!doc.hideAll,
          groups: [...(doc.groups || [])],
          cards:  [...(doc.cards  || [])],
          names:  [...(doc.names  || [])],
          eras:   [...(doc.eras   || [])],
        };

        if (mode === 'clear') {
          doc.hideAll = false;
          doc.groups = []; doc.cards = []; doc.names = []; doc.eras = [];
        } else {
          if (hideAllStr) doc.hideAll = YES.test(hideAllStr);

          if (mode === 'replace') {
            if (groups.length) doc.groups = uniqCI(groups);
            if (cards.length)  doc.cards  = uniqCI(cards);
            if (names.length)  doc.names  = uniqCI(names);
            if (eras.length)   doc.eras   = uniqCI(eras);
          } else if (mode === 'add') {
            if (groups.length) doc.groups = uniqCI([...(doc.groups || []), ...groups]);
            if (cards.length)  doc.cards  = uniqCI([...(doc.cards  || []), ...cards]);
            if (names.length)  doc.names  = uniqCI([...(doc.names  || []), ...names]);
            if (eras.length)   doc.eras   = uniqCI([...(doc.eras   || []), ...eras]);
          } else if (mode === 'remove') {
            if (groups.length) doc.groups = removeCI(doc.groups || [], groups);
            if (cards.length)  doc.cards  = removeCI(doc.cards  || [], cards);
            if (names.length)  doc.names  = removeCI(doc.names  || [], names);
            if (eras.length)   doc.eras   = removeCI(doc.eras   || [], eras);
          }
        }

        await doc.save();

        const after = {
          hideAll: !!doc.hideAll,
          groups: doc.groups || [],
          cards:  doc.cards  || [],
          names:  doc.names  || [],
          eras:   doc.eras   || [],
        };

        const deltaEmbed = buildDeltaEmbed(interaction.user, before, after, mode);
        return interaction.editReply({ embeds: [deltaEmbed] });
      }
      return;
    }

    // Handle our own pagination buttons here (no router needed)
    if (interaction.isButton?.() && (interaction.customId || '').startsWith('iprv|')) {
      const parts = interaction.customId.split('|');
      // iprv|noop  OR  iprv|view|<ownerId>|<bucket>|<page>|<ACTION>
      if (parts[1] === 'noop') {
        return interaction.deferUpdate();
      }
      if (parts[1] === 'view') {
        const ownerId = parts[2];
        const bucket = parts[3];
        let page = Number(parts[4]) || 1;
        const action = parts[5];

        // Only the owner may paginate their ephemeral view
        if (interaction.user.id !== ownerId) {
          return interaction.reply({ content: 'You cannot control another user’s view.', ephemeral: true });
        }

        const doc = await IndexPrivacy.findOne({ userId: ownerId });
        if (!doc) return interaction.update({ content: 'No privacy doc found.', embeds: [], components: [] });

        // Compute last-page jump when needed
        const list = sortCI(doc[bucket] || []);
        const totalPages = Math.max(1, Math.ceil(list.length / DEFAULT_PAGE_SIZE));
        if (action === 'F') page = 1;
        if (action === 'L') page = totalPages;
        // P and N already encode the target page number in the customId

        const ui = buildViewUI({ viewer: interaction.user, ownerId, doc, bucket, page });
        return interaction.update(ui);
      }
    }
  }
};
