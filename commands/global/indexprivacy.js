// commands/global/indexprivacy.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const IndexPrivacy = require('../../models/IndexPrivacy');

// ===== Config =====
const YES = /^(yes|true|1|on)$/i;
const DEFAULT_PAGE_SIZE = 20;

// ===== Utilities =====
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
const sortCI = (arr) =>
  [...(arr || [])].sort((a, b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()));

function paginate(list, page, pageSize = DEFAULT_PAGE_SIZE) {
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  const slice = list.slice((p - 1) * pageSize, (p - 1) * pageSize + pageSize);
  return {
    page: p,
    totalPages,
    total,
    text: slice.length ? slice.map(v => `• ${v}`).join('\n') : '(none)',
  };
}

// ===== Embeds =====
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

  // Added/removed diffs (optional: could expand if you want to show details)
  if (JSON.stringify(before) === JSON.stringify(after)) {
    embed.setDescription(`Mode: **${toTitle(mode)}** — no list changes.`);
  } else {
    embed.setDescription(`Mode: **${toTitle(mode)}** — changes applied.`);
  }
  return embed;
}

function buildViewUI({ viewer, ownerId, doc, page = 1 }) {
  const combined = [
    ...sortCI(doc.groups || []).map(v => `[Group] ${v}`),
    ...sortCI(doc.cards  || []).map(v => `[Card] ${v}`),
    ...sortCI(doc.names  || []).map(v => `[Name] ${v}`),
    ...sortCI(doc.eras   || []).map(v => `[Era] ${v}`),
  ];

  const pageInfo = paginate(combined, page);

  const embed = new EmbedBuilder()
    .setTitle('Your Index Privacy')
    .setColor(doc.hideAll ? 0xFF006E : 0x2196F3)
    .setDescription(
      `hideAll: **${doc.hideAll ? 'ON' : 'OFF'}**\n` +
      `Page **${pageInfo.page}/${pageInfo.totalPages}** • Items: **${combined.length}**`
    )
    .addFields({ name: 'Entries', value: pageInfo.text })
    .setFooter({ text: viewer.username })
    .setTimestamp();

  const mkId = (p, action) => `iprv|view|${ownerId}|${p}|${action}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(mkId(1, 'F')).setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(pageInfo.page <= 1),
    new ButtonBuilder().setCustomId(mkId(Math.max(1, pageInfo.page - 1), 'P')).setEmoji('◀️').setStyle(ButtonStyle.Primary).setDisabled(pageInfo.page <= 1),
    new ButtonBuilder().setCustomId(mkId(Math.min(pageInfo.totalPages, pageInfo.page + 1), 'N')).setEmoji('▶️').setStyle(ButtonStyle.Primary).setDisabled(pageInfo.page >= pageInfo.totalPages),
    new ButtonBuilder().setCustomId(mkId(pageInfo.totalPages, 'L')).setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(pageInfo.page >= pageInfo.totalPages),
  );

  return { embeds: [embed], components: [row] };
}

// ===== Command =====
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
        .addStringOption(o => o.setName('cards').setDescription('Cards, comma-separated'))
        .addStringOption(o => o.setName('names').setDescription('Names, comma-separated'))
        .addStringOption(o => o.setName('eras').setDescription('Eras, comma-separated'))
    )
    .addSubcommand(sc =>
      sc.setName('view').setDescription('View your privacy settings with pagination.')
    ),

  async execute(interaction) {
    // Slash commands
    if (interaction.isChatInputCommand?.()) {
      await interaction.deferReply({ ephemeral: true });
      const sub = interaction.options.getSubcommand();
      const userId = interaction.user.id;

      let doc = await IndexPrivacy.findOne({ userId });
      if (!doc) {
        doc = new IndexPrivacy({ userId, hideAll: false, groups: [], cards: [], names: [], eras: [] });
        await doc.save();
      }

      if (sub === 'view') {
        const ui = buildViewUI({ viewer: interaction.user, ownerId: userId, doc, page: 1 });
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

    // Pagination buttons
    if (interaction.isButton?.() && (interaction.customId || '').startsWith('iprv|')) {
      const parts = interaction.customId.split('|');
      if (parts[1] === 'view') {
        const ownerId = parts[2];
        let page = Number(parts[3]) || 1;
        const action = parts[4];

        if (interaction.user.id !== ownerId) {
          return interaction.reply({ content: 'You cannot control another user’s view.', ephemeral: true });
        }

        const doc = await IndexPrivacy.findOne({ userId: ownerId });
        if (!doc) return interaction.update({ content: 'No privacy doc found.', embeds: [], components: [] });

        const combined = [
          ...sortCI(doc.groups || []),
          ...sortCI(doc.cards  || []),
          ...sortCI(doc.names  || []),
          ...sortCI(doc.eras   || []),
        ];
        const totalPages = Math.max(1, Math.ceil(combined.length / DEFAULT_PAGE_SIZE));

        if (action === 'F') page = 1;
        if (action === 'L') page = totalPages;
        // P and N already encode the target page

        const ui = buildViewUI({ viewer: interaction.user, ownerId, doc, page });
        return interaction.update(ui);
      }
      if (parts[1] === 'noop') return interaction.deferUpdate();
    }
  }
};
