// commands/cds/viewcds.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
  AttachmentBuilder
} = require('discord.js');

const path = require('path');
const fs = require('fs');
const sharp = require('sharp'); // npm i sharp

const CD = require('../../models/CD');
const UserCD = require('../../models/UserCD');
const { safeReply } = require('../../utils/safeReply');

// ---------- config ----------
const PAGE_SIZE = 6;                  // CDs per page
const IMAGE_FIELD = 'localImagePath'; // where CD stores the local image
const GRAY_DIR = '/var/cds/_gray';    // cached grayscale images

// Ensure grayscale cache dir exists
if (!fs.existsSync(GRAY_DIR)) {
  try { fs.mkdirSync(GRAY_DIR, { recursive: true }); } catch { /* ignore at import time */ }
}

// Simple 10-step progress bar
function progressBar(current, total, width = 20) {
  if (total <= 0) return '[──────────] 0/0';
  const ratio = Math.max(0, Math.min(1, current / total));
  const filled = Math.round(width * ratio);
  const bar = '█'.repeat(filled) + '─'.repeat(width - filled);
  return `[${bar}] ${current}/${total}`;
}

function requirementText(cd) {
  return cd.active ? 'Active Era only' : 'Active + Inactive Eras';
}

// Build (and cache) grayscale copy for a given original file
async function getGrayPath(originalPath) {
  try {
    const base = path.basename(originalPath);
    const out = path.join(GRAY_DIR, base);
    if (fs.existsSync(out)) return out;

    // Make sure source exists
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

// Build the embeds + attachments for a page
async function buildPageEmbeds(userId, cds, ownedSet, ownedCount, totalCount, pageIdx, totalPages) {
  const embeds = [];
  const files = [];

  // Top “header” embed with progress bar
  const header = new EmbedBuilder()
    .setColor('Blurple')
    .setTitle('CD Collection')
    .setDescription(`${progressBar(ownedCount, totalCount)}\nPage ${pageIdx + 1}/${totalPages}`);
  embeds.push(header);

  // Per-CD embeds (up to PAGE_SIZE)
  for (const cd of cds) {
    const owned = ownedSet.has(String(cd._id));
    const imgPath = cd[IMAGE_FIELD];
    let attachName = null;

    if (imgPath && fs.existsSync(imgPath)) {
      if (owned) {
        // Color image
        attachName = `cd_${cd._id}_color${path.extname(imgPath) || '.png'}`;
        files.push(new AttachmentBuilder(imgPath, { name: attachName }));
      } else {
        // Gray (cache)
        const grayPath = await getGrayPath(imgPath);
        const chosen = grayPath && fs.existsSync(grayPath) ? grayPath : imgPath; // fallback to color if gray fails
        attachName = `cd_${cd._id}_gray${path.extname(chosen) || '.png'}`;
        files.push(new AttachmentBuilder(chosen, { name: attachName }));
      }
    }

    const e = new EmbedBuilder()
      .setTitle(`${owned ? '✅' : '⬜'} ${cd.title}`)
      .setColor(owned ? 0x00a86b : 0x777777)
      .addFields(
        { name: 'Owned', value: owned ? 'Yes' : 'No', inline: true },
        { name: 'Available', value: String(cd.available), inline: true },
        { name: 'Requires', value: requirementText(cd), inline: true },
        { name: 'Active Era', value: cd.activeEra || '—', inline: true },
        { name: 'Inactive Era', value: cd.inactiveEra || '—', inline: true },
      );

    if (attachName) e.setImage(`attachment://${attachName}`);

    embeds.push(e);
  }

  return { embeds, files };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('viewcds')
    .setDescription('View your CD collection with progress and pagination'),
  async execute(interaction) {
    try {
      // Pull collection + ownership
      const [allCds, ownedRows] = await Promise.all([
        CD.find({}).sort({ title: 1 }),
        UserCD.find({ userId: interaction.user.id }).select('cdId')
      ]);

      const totalCount = allCds.length;
      const ownedSet = new Set(ownedRows.map(r => String(r.cdId)));
      const ownedCount = ownedSet.size;

      if (totalCount === 0) {
        return interaction.editReply({ content: 'No CDs exist yet.' });
      }

      // Pagination state
      const totalPages = Math.ceil(totalCount / PAGE_SIZE);
      let pageIdx = 0;

      const slicePage = (idx) => allCds.slice(idx * PAGE_SIZE, idx * PAGE_SIZE + PAGE_SIZE);

      // Build initial page
      const firstBatch = slicePage(pageIdx);
      const { embeds, files } = await buildPageEmbeds(
        interaction.user.id,
        firstBatch,
        ownedSet,
        ownedCount,
        totalCount,
        pageIdx,
        totalPages
      );

      const prevBtn = new ButtonBuilder()
        .setCustomId('prev')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary);
      const nextBtn = new ButtonBuilder()
        .setCustomId('next')
        .setEmoji('➡️')
        .setStyle(ButtonStyle.Secondary);
      const closeBtn = new ButtonBuilder()
        .setCustomId('close')
        .setLabel('Close')
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(prevBtn, nextBtn, closeBtn);

      await safeReply(interaction, { embeds, files, components: [row] });
      const msg = await interaction.fetchReply();

      // Collector for pagination
      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 5 * 60 * 1000 // 5 minutes
      });

      const render = async () => {
        const batch = slicePage(pageIdx);
        const built = await buildPageEmbeds(
          interaction.user.id,
          batch,
          ownedSet,
          ownedCount,
          totalCount,
          pageIdx,
          totalPages
        );
        // Disable buttons at edges
        prevBtn.setDisabled(pageIdx === 0);
        nextBtn.setDisabled(pageIdx >= totalPages - 1);
        const controls = new ActionRowBuilder().addComponents(prevBtn, nextBtn, closeBtn);
        await interaction.editReply({ embeds: built.embeds, files: built.files, components: [controls] });
      };

      collector.on('collect', async (btn) => {
        if (btn.user.id !== interaction.user.id) {
          return btn.reply({ content: 'Only the command invoker can paginate this view.', ephemeral: true });
        }
        try {
          await btn.deferUpdate();
        } catch { /* noop */ }

        if (btn.customId === 'prev' && pageIdx > 0) {
          pageIdx -= 1;
          await render();
        } else if (btn.customId === 'next' && pageIdx < totalPages - 1) {
          pageIdx += 1;
          await render();
        } else if (btn.customId === 'close') {
          collector.stop('closed');
          try {
            await interaction.editReply({ components: [], content: 'Viewer closed.', embeds: [] });
          } catch { /* noop */ }
        }
      });

      collector.on('end', async (_, reason) => {
        if (reason !== 'closed') {
          try {
            prevBtn.setDisabled(true);
            nextBtn.setDisabled(true);
            closeBtn.setDisabled(true);
            const controls = new ActionRowBuilder().addComponents(prevBtn, nextBtn, closeBtn);
            await interaction.editReply({ components: [controls] });
          } catch { /* noop */ }
        }
      });
    } catch (err) {
      console.error('Error in /viewcds:', err);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({ content: 'There was an error executing the command.', ephemeral: true });
      }
    }
  }
};
