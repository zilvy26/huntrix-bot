// commands/templates/edittemplate.js
require('dotenv').config();
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const fs = require('fs/promises');
const fssync = require('fs');
const path = require('path');
const crypto = require('crypto');

const Template = require('../../models/Template');
const UserTemplateInventory = require('../../models/UserTemplateInventory');
const UserProfile = require('../../models/UserProfile');

const {
  TEMPLATES_DIR,
} = require('../../config/storage');

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_BYTES = 10 * 1024 * 1024;

/* ----------------------------- helpers ----------------------------- */

function cleanBaseName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function assertAllowedExtOrThrow(name) {
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(`Unsupported image extension "${ext}". Allowed: ${Array.from(ALLOWED_EXT).join(', ')}`);
  }
  return ext;
}

async function ensureDir() {
  await fs.mkdir(TEMPLATES_DIR, { recursive: true });
}

async function saveAttachmentToTemplates(attachment, preferredBase) {
  await ensureDir();

  const { url, name, contentType, size } = attachment;
  if (typeof size === 'number' && size > MAX_BYTES) {
    throw new Error(`Attachment too large (${Math.round(size/1024/1024)}MB). Max ${MAX_BYTES/1024/1024}MB`);
  }
  const ext = assertAllowedExtOrThrow(name || preferredBase);
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error(`Attachment content-type is not image/* (${contentType})`);
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download attachment: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`Downloaded file too large (${Math.round(buf.length/1024/1024)}MB)`);

  const head = buf.subarray(0, 12).toString('hex');
  const looksImage = head.startsWith('89504e47') || head.startsWith('ffd8ff') || head.includes('57454250');
  if (!looksImage) throw new Error('Attachment does not look like a supported image');

  const short = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 6);
  const basename = cleanBaseName(`${preferredBase}-${short}${ext}`);
  let final = path.join(TEMPLATES_DIR, basename);
  let i = 0;
  while (fssync.existsSync(final)) {
    i += 1;
    final = path.join(TEMPLATES_DIR, cleanBaseName(`${preferredBase}-${short}-${i}${ext}`));
  }
  await fs.writeFile(final, buf, { mode: 0o640 });
  return path.basename(final);
}

async function assertFileInTemplates(filename) {
  const abs = path.resolve(TEMPLATES_DIR, filename);
  const base = path.resolve(TEMPLLES_DIR); // typo guard below fixes
}

/* ----------------------------- command ----------------------------- */

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edittemplate')
    .setDescription('Admin: edit an existing profile template (and propagate changes)')
    .setDefaultMemberPermissions('0')

    // identify which template to edit (by label, case-insensitive)
    .addStringOption(o =>
      o.setName('label')
       .setDescription('Existing template label to edit (case-insensitive)')
       .setRequired(true)
    )

    // content updates
    .addStringOption(o =>
      o.setName('new_label')
       .setDescription('Rename the label (will update everyone’s inventories & selected labels)')
    )
    .addStringOption(o =>
      o.setName('filename')
       .setDescription('Switch to an existing file in /var/templates (e.g., my.png)')
    )
    .addAttachmentOption(o =>
      o.setName('image')
       .setDescription('Upload a new image file (png/jpg/jpeg/webp) to replace the current file')
    )

    // flags
    .addBooleanOption(o => o.setName('active').setDescription('Usable/obtainable? default unchanged'))
    .addBooleanOption(o => o.setName('visible').setDescription('Show in /boutique preview? default unchanged'))

    // acquire rules (set or clear)
    .addIntegerOption(o => o.setName('price').setDescription('Set price in Sopop'))
    .addBooleanOption(o => o.setName('clear_price').setDescription('Clear the price'))
    .addStringOption(o => o.setName('roles').setDescription('Set required role IDs (comma/space separated)'))
    .addBooleanOption(o => o.setName('clear_roles').setDescription('Clear roles requirement'))
    .addStringOption(o => o.setName('era').setDescription('Set the era key required (e.g., S2, Kanto)'))
    .addBooleanOption(o => o.setName('eracomplete').setDescription('Require complete era?'))
    .addBooleanOption(o => o.setName('clear_era').setDescription('Clear era requirement'))
    .addBooleanOption(o => o.setName('available').setDescription('Mark as freely claimable (no checks)'))
  ,

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    try {
      if (!interaction.member.roles.cache.has(process.env.MAIN_BYPASS_ID)) {
          return safeReply(interaction, { content: 'You do not have permission to use this command.' });
          }

      const label = interaction.options.getString('label', true).trim();

      // find (case-insensitive)
      const tpl = await Template.findOne({ label: { $regex: `^${label}$`, $options: 'i' } });
      if (!tpl) return interaction.editReply({ ephemeral: true, content: `No template with label **${label}**.` });

      const prevLabel = tpl.label;

      // read options
      const newLabel = interaction.options.getString('new_label')?.trim() || null;
      const filenameOpt = interaction.options.getString('filename');
      const image = interaction.options.getAttachment('image');

      const active = interaction.options.getBoolean('active');
      const visible = interaction.options.getBoolean('visible');

      const price = interaction.options.getInteger('price');
      const clearPrice = interaction.options.getBoolean('clear_price') ?? false;

      const rolesRaw = interaction.options.getString('roles');
      const clearRoles = interaction.options.getBoolean('clear_roles') ?? false;

      const era = interaction.options.getString('era');
      const eraComplete = interaction.options.getBoolean('eracomplete');
      const clearEra = interaction.options.getBoolean('clear_era') ?? false;

      const available = interaction.options.getBoolean('available');

      // start editing
      // 1) label rename (we’ll propagate after save)
      if (newLabel) tpl.label = newLabel;

      // 2) image/filename replacement
      if (image && filenameOpt) {
        return interaction.editReply({ ephemeral: true, content: '❌ Choose either an image OR a filename, not both.' });
      }
      if (image) {
        const saved = await saveAttachmentToTemplates(image, (newLabel || prevLabel).replace(/\s+/g, '-').toLowerCase());
        tpl.filename = saved;
      } else if (filenameOpt) {
        // verify it exists under /var/templates
        const filename = cleanBaseName(filenameOpt);
        assertAllowedExtOrThrow(filename);
        const abs = path.resolve(TEMPLATES_DIR, filename);
        const base = path.resolve(TEMPLATES_DIR);
        if (!abs.startsWith(base + path.sep) && abs !== base) {
          return interaction.editReply({ ephemeral: true, content: '❌ Invalid filename path.' });
        }
        await fs.access(abs).catch(() => { throw new Error('File not found in /var/templates'); });
        tpl.filename = filename;
      }

      // 3) flags
      if (typeof active === 'boolean') tpl.active = active;
      if (typeof visible === 'boolean') tpl.boutiqueVisible = visible;

      // 4) acquire rules
      tpl.acquire ??= {};

      if (clearPrice) {
        tpl.acquire.price = null;
      } else if (price != null) {
        tpl.acquire.price = price;
      }

      if (clearRoles) {
        tpl.acquire.roles = [];
      } else if (rolesRaw != null) {
        tpl.acquire.roles = rolesRaw.split(/[, ]+/).map(s => s.trim()).filter(Boolean);
      }

      if (clearEra) {
        tpl.acquire.requireEra = null;
        tpl.acquire.requireEraComplete = false;
      } else {
        if (era != null) tpl.acquire.requireEra = era;
        if (typeof eraComplete === 'boolean') tpl.acquire.requireEraComplete = era ? !!eraComplete : false;
      }

      if (typeof available === 'boolean') tpl.acquire.available = available;

      await tpl.save();

      // 5) PROPAGATE label rename (inventory + current profile)
      let invUpdated = 0;
      let profUpdated = 0;
      if (newLabel && newLabel !== prevLabel) {
        // Update all UserTemplateInventory entries where templates array contains prevLabel
        const invRes = await UserTemplateInventory.updateMany(
          { templates: prevLabel },
          { $set: { "templates.$[el]": newLabel } },
          { arrayFilters: [{ el: prevLabel }] }
        );
        invUpdated = invRes.modifiedCount || 0;

        // Update all current UserProfiles using this label
        const profRes = await UserProfile.updateMany(
          { templateLabel: prevLabel },
          { $set: { templateLabel: newLabel } }
        );
        profUpdated = profRes.modifiedCount || 0;
      }

      const changes = [
        newLabel && `label: **${prevLabel}** → **${newLabel}**`,
        (image || filenameOpt) && `file: \`${tpl.filename}\``,
        typeof active === 'boolean' && `active: **${tpl.active ? 'yes' : 'no'}**`,
        typeof visible === 'boolean' && `visible: **${tpl.boutiqueVisible ? 'yes' : 'no'}**`,
        (price != null || clearPrice) && `price: ${clearPrice ? 'cleared' : price}`,
        (rolesRaw != null || clearRoles) && `roles: ${clearRoles ? 'cleared' : (tpl.acquire.roles?.length || 0) + ' set'}`,
        (era != null || typeof eraComplete === 'boolean' || clearEra) &&
          `era: ${clearEra ? 'cleared' : `${tpl.acquire.requireEra || 'none'}${tpl.acquire.requireEraComplete ? ' (complete)' : ''}`}`,
        typeof available === 'boolean' && `available: **${tpl.acquire.available ? 'yes' : 'no'}**`,
      ].filter(Boolean).join('\n• ');

      return interaction.editReply({
        content:
          `Template updated.\n` +
          (changes ? `• ${changes}\n` : '') +
          (newLabel && newLabel !== prevLabel
            ? `\nPropagated label rename → inventories updated: **${invUpdated}**, profiles updated: **${profUpdated}**.`
            : '')
      });
    } catch (err) {
      console.error('edittemplate error:', err);
      return interaction.editReply({ ephemeral: true, content: `❌ ${err.message}` });
    }
  }
};
