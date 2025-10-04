// commands/cds/viewcds.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  AttachmentBuilder
} = require('discord.js');

const path = require('path');
const fs = require('fs');
const sharp = require('sharp'); // npm i sharp

const CD = require('../../models/CD');
const UserCD = require('../../models/UserCD');
const { safeReply } = require('../../utils/safeReply');

// ---------- config ----------
const IMAGE_FIELD = 'localImagePath';
const GRAY_DIR = '/var/cds/_gray'; // cached grayscale images

if (!fs.existsSync(GRAY_DIR)) {
  try { fs.mkdirSync(GRAY_DIR, { recursive: true }); } catch { /* ignore on import */ }
}

function progressBar(current, total, width = 20) {
  if (total <= 0) return '[──────────] 0/0';
  const ratio = Math.max(0, Math.min(1, current / total));
  const filled = Math.round(width * ratio);
  const bar = '█'.repeat(filled) + '─'.repeat(width - filled);
  return `[${bar}] ${current}/${total}`;
}

const reqText = (cd) => (cd.active ? 'Active Era only' : 'Active + Inactive Eras');

async function getGrayPath(originalPath) {
  try {
    const base = path.basename(originalPath);
    const out = path.join(GRAY_DIR, base);
    if (fs.existsSync(out)) return out;
    if (!fs.existsSync(originalPath)) return null;

    await sharp(originalPath)
      .grayscale()
      .modulate({ brightness: 0.85, saturation: 0.2 })
      .toFile(out);

    return out;
  } catch (e) {
    console.error('gray gen error', e);
    return null;
  }
}

// Build ONE embed + its image attachment for a single CD page
async function buildSingleCdPage({ cd, owned, ownedCount, totalCount, pageIdx, totalPages }) {
  const lines = [
    `${progressBar(ownedCount, totalCount)}`,
    '',
    `${owned ? '**Owned**' : '*Not owned*'} • **Available:** ${cd.available ? 'Yes' : 'No'}`,
    `**Requires:** ${reqText(cd)}`,
    `**Active Era:** ${cd.activeEra || '—'} • **Inactive Era:** ${cd.inactiveEra || '—'}`
  ];

  const embed = new EmbedBuilder()
    .setColor(owned ? 0x00a86b : 0x777777)
    .setTitle(cd.title)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Page ${pageIdx + 1}/${totalPages}` }); // router relies on this

  const files = [];
  if (cd[IMAGE_FIELD] && fs.existsSync(cd[IMAGE_FIELD])) {
    let chosenPath = cd[IMAGE_FIELD];
    if (!owned) {
      const grayPath = await getGrayPath(cd[IMAGE_FIELD]);
      if (grayPath && fs.existsSync(grayPath)) chosenPath = grayPath;
    }
    const attachName = `cd_${cd._id}_${owned ? 'color' : 'gray'}${path.extname(chosenPath) || '.png'}`;
    files.push(new AttachmentBuilder(chosenPath, { name: attachName }));
    embed.setImage(`attachment://${attachName}`);
  }

  return { embeds: [embed], files };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('viewcds')
    .setDescription('View CDs: one CD per page (single-embed), showcase-style controls'),

  async execute(interaction) {
    // Load all CDs + ownership for the viewer
    const [allCds, ownedRows] = await Promise.all([
      CD.find({}).sort({ title: 1 }),
      UserCD.find({ userId: interaction.user.id }).select('cdId')
    ]);

    const totalCount = allCds.length;
    if (totalCount === 0) {
      return interaction.editReply({ content: 'No CDs exist yet.' });
    }

    const ownedSet = new Set(ownedRows.map(r => String(r.cdId)));
    const ownedCount = ownedSet.size;

    // Build one page per CD (single embed each)
    const totalPages = totalCount;
    const pages = [];
    for (let i = 0; i < totalPages; i++) {
      const cd = allCds[i];
      const owned = ownedSet.has(String(cd._id));
      // eslint-disable-next-line no-await-in-loop
      const page = await buildSingleCdPage({
        cd,
        owned,
        ownedCount,
        totalCount,
        pageIdx: i,
        totalPages
      });
      pages.push(page);
    }

    // Cache pages for your interaction router (like showcase)
    interaction.client.cache = interaction.client.cache || {};
    interaction.client.cache.viewcds = interaction.client.cache.viewcds || {};
    interaction.client.cache.viewcds[interaction.user.id] = pages;

    // Showcase-like buttons (your custom emoji IDs/styles)
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cd_first').setStyle(ButtonStyle.Secondary)
        .setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new ButtonBuilder().setCustomId('cd_prev').setStyle(ButtonStyle.Primary)
        .setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new ButtonBuilder().setCustomId('cd_next').setStyle(ButtonStyle.Primary)
        .setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
      new ButtonBuilder().setCustomId('cd_last').setStyle(ButtonStyle.Secondary)
        .setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
      new ButtonBuilder().setCustomId('cd_close').setStyle(ButtonStyle.Danger)
        .setLabel('Close')
    );

    // Send first page
    await safeReply(interaction, {
      embeds: pages[0].embeds,
      components: [row],
      files: pages[0].files ?? []
    });
  }
};
