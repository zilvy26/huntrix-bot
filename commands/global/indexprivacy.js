const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const IndexPrivacy = require('../../models/IndexPrivacy');
const { safeReply } = require('../../utils/safeReply');

// --- Helpers ---
const YES = /^(yes|true|1|on)$/i;
const BUCKETS = ['cards', 'groups', 'names', 'eras'];
const DEFAULT_PAGE_SIZE = 20;

const parseList = (s) => (s || '').split(',').map(v => v.trim()).filter(Boolean);
const toTitle = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
const uniqCI = (list) => {
  const seen = new Set(); const out = [];
  for (const item of (list || [])) {
    const k = item.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(item); }
  }
  return out;
};
const removeCI = (src, removing) => {
  const rm = new Set((removing || []).map(x => x.toLowerCase()));
  return (src || []).filter(v => !rm.has(v.toLowerCase()));
};
const calcDelta = (before = [], after = []) => {
  const b = new Set(before.map(x => x.toLowerCase()));
  const a = new Set(after.map(x => x.toLowerCase()));
  return {
    added: after.filter(x => !b.has(x.toLowerCase())),
    removed: before.filter(x => !a.has(x.toLowerCase())),
  };
};
const truncate = (text, max = 1024) =>
  !text ? '' : text.length <= max ? text : text.slice(0, max - 3) + '…';

const fmtPage = (list, page, pageSize = DEFAULT_PAGE_SIZE) => {
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  const slice = list.slice((p - 1) * pageSize, (p - 1) * pageSize + pageSize);
  return {
    page: p,
    totalPages,
    text: slice.length ? slice.map(v => `• ${v}`).join('\n') : '(none)',
    total,
  };
};

// --- Embeds ---
function buildDeltaEmbed(user, before, after, { mode }) {
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
    embed.addFields({
      name: 'Privacy',
      value: 'All privacy lists cleared, hideAll: **OFF**',
    });
  }

  for (const field of BUCKETS) {
    const { added, removed } = calcDelta(before[field], after[field]);
    if (!added.length && !removed.length && mode !== 'replace') continue;
    const lines = [];
    if (added.length)   lines.push(`**Added** (${added.length})\n${truncate(added.map(v => `• ${v}`).join('\n'))}`);
    if (removed.length) lines.push(`**Removed** (${removed.length})\n${truncate(removed.map(v => `• ${v}`).join('\n'))}`);
    embed.addFields({ name: toTitle(field), value: lines.join('\n\n') || '(no changes)' });
  }

  if (!embed.data.fields?.length) {
    embed.setDescription(`Mode: **${toTitle(mode)}**\nNo changes.`);
  } else {
    embed.setDescription(`Mode: **${toTitle(mode)}**\nOnly this operation’s changes are shown. Use \`/indexprivacy view\` for full list.`);
  }
  return embed;
}

function buildViewUI({ viewer, ownerId, doc, bucket = 'cards', page = 1 }) {
  if (!BUCKETS.includes(bucket)) bucket = 'cards';
  const lists = { cards: doc.cards || [], groups: doc.groups || [], names: doc.names || [], eras: doc.eras || [] };
  const pageInfo = fmtPage(lists[bucket], page);

  const embed = new EmbedBuilder()
    .setTitle('Your Index Privacy')
    .setColor(doc.hideAll ? 0xFF006E : 0x2196F3)
    .setDescription(
      `hideAll: **${doc.hideAll ? 'ON' : 'OFF'}**\n` +
      `Bucket: **${toTitle(bucket)}** • Page **${pageInfo.page}/${pageInfo.totalPages}** • Items: **${lists[bucket].length}**`
    )
    .addFields({ name: toTitle(bucket), value: truncate(pageInfo.text) })
    .setFooter({ text: viewer.username })
    .setTimestamp();

  const idx = BUCKETS.indexOf(bucket);
  const prevBucket = BUCKETS[(idx - 1 + BUCKETS.length) % BUCKETS.length];
  const nextBucket = BUCKETS[(idx + 1) % BUCKETS.length];

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
    new ButtonBuilder().setCustomId(`iprv|close|${ownerId}|X`).setLabel('Close').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [rowBuckets, rowPages] };
}

// --- Main Export ---
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
        .addStringOption(o => o.setName('cards').setDescription('Card codes (comma separated)'))
        .addStringOption(o => o.setName('groups').setDescription('Groups (comma separated)'))
        .addStringOption(o => o.setName('names').setDescription('Names (comma separated)'))
        .addStringOption(o => o.setName('eras').setDescription('Eras (comma separated)'))
    )
    .addSubcommand(sc =>
      sc.setName('view')
        .setDescription('View your privacy settings with pagination.')
    ),

  async execute(interaction) {
    // Slash command
    if (interaction.isChatInputCommand()) {
      await safeReply(interaction, { ephemeral: true });
      const sub = interaction.options.getSubcommand();
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

      if (sub === 'set') {
        const mode = interaction.options.getString('mode');
        const hideAllStr = interaction.options.getString('hide_all');
        const cards  = parseList(interaction.options.getString('cards'));
        const groups = parseList(interaction.options.getString('groups'));
        const names  = parseList(interaction.options.getString('names'));
        const eras   = parseList(interaction.options.getString('eras'));

        const before = doc ? {
          hideAll: !!doc.hideAll,
          cards: [...(doc.cards || [])],
          groups: [...(doc.groups || [])],
          names: [...(doc.names || [])],
          eras:  [...(doc.eras  || [])],
        } : { hideAll: false, cards: [], groups: [], names: [], eras: [] };

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
    }

    // Buttons
    if (interaction.isButton() && (interaction.customId || '').startsWith('iprv|')) {
      const parts = interaction.customId.split('|');
      if (parts[1] === 'noop') return interaction.deferUpdate();
      if (parts[1] === 'close') {
        if (interaction.user.id !== parts[2]) {
          return interaction.reply({ content: 'Only the owner can close this.', ephemeral: true });
        }
        return interaction.update({ embeds: interaction.message.embeds, components: [] });
      }
      if (parts[1] === 'view') {
        const ownerId = parts[2];
        if (interaction.user.id !== ownerId) {
          return interaction.reply({ content: 'You cannot control another user’s view.', ephemeral: true });
        }
        const bucket = parts[3];
        let page = Number(parts[4]) || 1;
        const action = parts[5];
        const doc = await IndexPrivacy.findOne({ userId: ownerId });
        if (!doc) return interaction.update({ content: 'No privacy doc found.', embeds: [], components: [] });

        const list = doc[bucket] || [];
        const totalPages = Math.max(1, Math.ceil(list.length / DEFAULT_PAGE_SIZE));
        if (action === 'F') page = 1;
        if (action === 'L') page = totalPages;
        // P and N already encode page number

        const ui = buildViewUI({ viewer: interaction.user, ownerId, doc, bucket, page });
        return interaction.update(ui);
      }
    }
  }
};
