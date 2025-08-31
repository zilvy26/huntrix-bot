// commands/boutique/subcommands/boutiquePreview.js
const {
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const path = require('path');
const fs = require('fs/promises');

const Template = require('../../../models/Template'); // { label, filename, boutiqueVisible, acquire }
const User = require('../../../models/User'); // for cards price list (no balance read needed here)
const UserTemplateInventory = require('../../../models/UserTemplateInventory'); // { userId, templates: [label] }
const { safeReply } = require('../../../utils/safeReply');
const { TEMPLATES_DIR } = require('../../../config/storage');

/* ----------------------------- helpers ----------------------------- */

function normalizeLabels(arr) {
  return new Set((arr || []).map(s => String(s).toLowerCase()));
}

function formatRoles(interaction, roleIds = []) {
  if (!roleIds?.length) return '';
  const names = roleIds.map(id => {
    const role = interaction.guild?.roles?.cache?.get(id);
    return role ? role.name : `<@&${id}>`; // mention fallback if not cached
  });
  return names.join(', ');
}

function requirementLines(interaction, acq = {}) {
  const lines = [];
  if (acq.price != null) lines.push(`**• Price:** <:ehx_sopop:1389584273337618542> ${acq.price.toLocaleString()} Sopop`);
  if (Array.isArray(acq.roles) && acq.roles.length) {
    const r = formatRoles(interaction, acq.roles);
    if (r) lines.push(`**• Role(s):** ${r}`);
  }
  if (acq.requireEra && acq.requireEraComplete) {
    lines.push(`**• Complete Era of:** ${acq.requireEra}`);
  } else if (acq.requireEra) {
    lines.push(`**• Era:** ${acq.requireEra}`);
  }
  return lines;
}

async function filePathUnderTemplates(filename) {
  const abs = path.resolve(TEMPLATES_DIR, filename);
  const base = path.resolve(TEMPLATES_DIR);
  if (!abs.startsWith(base + path.sep) && abs !== base) throw new Error('Path traversal blocked');
  await fs.access(abs);
  return abs;
}

function pagerRow(pageIdx, total) {
  // same UX as /showcase, namespaced IDs to avoid collisions
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tpl_first').setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIdx === 0)
      .setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
    new ButtonBuilder().setCustomId('tpl_prev').setStyle(ButtonStyle.Primary)
      .setDisabled(pageIdx === 0)
      .setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
    new ButtonBuilder().setCustomId('tpl_next').setStyle(ButtonStyle.Primary)
      .setDisabled(pageIdx >= total - 1)
      .setEmoji({ id: '1390462706544410704', name: ':ehx_rightarrow' }),
    new ButtonBuilder().setCustomId('tpl_last').setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIdx >= total - 1)
      .setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
  );
}

/* ---------------------------- main handler ---------------------------- */

module.exports = async function boutiquePreview(interaction) {
  const type = interaction.options.getString('type', true);

  /* ------------------------- CARDS PREVIEW ------------------------- */
  if (type === 'cards') {
    // Inline single-embed, like your existing price list
    const cardOptions = [
      { name: '20x Random Cards + Guaranteed 5S', price: '12,500 Patterns' },
      { name: '10x Cards of Choice',              price: '8,500 Patterns'  },
      { name: '1x Zodiac Pull',                   price: '4 Sopop'         },
      { name: '1x Event Pull',                    price: '4 Sopop'         }
    ];

    const embed = new EmbedBuilder()
      .setTitle('Boutique Price List')
      .setColor('#f39c12')
      .setDescription(
        `**Card Pulls**\n` +
        cardOptions.map(o => `• **${o.name}** — ${o.price}`).join('\n')
      )
      .setFooter({ text: 'Use /boutique cards to buy card pulls.' });

    return safeReply(interaction, { embeds: [embed] });
  }

  /* ----------------------- TEMPLATES PREVIEW ----------------------- */
  if (type === 'templates') {

    // Show all templates marked visible; ignore "active"
    const templates = await Template.find(
      { boutiqueVisible: true },
      { label: 1, filename: 1, acquire: 1 }
    ).sort({ label: 1 }).lean();

    if (!templates.length) {
      return interaction.editReply({ content: 'No templates to display.' });
    }

    // Ownership (preferred new inventory by label)
    const userId = interaction.user.id;
    const inv = await UserTemplateInventory.findOne({ userId }).lean();
    const ownedByLabel = normalizeLabels(inv?.templates);

    // Build slides: one template per page (showcase-style)
    const slides = [];
    for (const t of templates) {
      let abs;
      try {
        abs = await filePathUnderTemplates(t.filename);
      } catch { continue; } // skip if file missing

      const attachName = `tpl_${t.label.replace(/\s+/g, '_').toLowerCase()}${path.extname(t.filename)}`;
      const owned = ownedByLabel.has(String(t.label).toLowerCase());
      const req = requirementLines(interaction, t.acquire || {});

      const baseDesc =
  `• **Template Label:** ${t.label}\n` +
  `• **Owned:** ${owned ? 'Yes' : 'No'}`;

const embed = new EmbedBuilder()
  .setTitle('Profile Templates')
  .setColor(owned ? 0x2ecc71 : 0xe67e22)
  .setImage(`attachment://${attachName}`)
  .setDescription(baseDesc)
  .setFooter({ text: 'Boutique Template Preview • 1/1' });

if (req.length) {
  embed.addFields({ name: 'Requirements', value: req.join('\n'), inline: false });
}

      slides.push({
        embed,
        attachment: new AttachmentBuilder(abs, { name: attachName })
      });
    }

    if (!slides.length) {
      return interaction.editReply({ content: 'No templates could be previewed (files missing).' });
    }

    // First page
    const total = slides.length;
    const pageIdx = 0;
    slides[pageIdx].embed.setFooter({ text: `Boutique Template Preview • ${pageIdx + 1}/${total}` });

    await interaction.editReply({
      embeds: [slides[pageIdx].embed],
      components: [pagerRow(pageIdx, total)],
      files: slides[pageIdx].attachment ? [slides[pageIdx].attachment] : []
    });

    // cache session like /showcase, namespaced to avoid collisions
    interaction.client.cache ??= {};
    interaction.client.cache.tplPreview ??= {};
    interaction.client.cache.tplPreview[userId] = slides;

    return; // done
  }

  // If somehow an unsupported type arrives
  return safeReply(interaction, { content: 'Unknown preview type.' });
};
