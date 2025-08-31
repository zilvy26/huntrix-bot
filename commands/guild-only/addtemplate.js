// commands/templates/addtemplate.js
require('dotenv').config();
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs/promises');
const fssync = require('fs');
const path = require('path');
const crypto = require('crypto');
const Template = require('../../models/Template');
const { TEMPLATES_DIR, ALLOWED_EXT, MAX_TEMPLATE_BYTES } = require('../../config/storage');

// Use Node 18+ global fetch; fallback for older runtimes (optional)
// const fetch = globalThis.fetch || (await import('node-fetch')).default;

function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `TPL-${s}`;
}

async function resolveUniqueCode() {
  for (let i = 0; i < 8; i++) {
    const code = genCode();
    if (!(await Template.exists({ code }))) return code;
  }
  return `TPL-${Date.now().toString(36).toUpperCase()}`;
}

function cleanBaseName(name) {
  // keep alnum, dot, dash, underscore
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function assertAllowedExtOrThrow(name) {
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(`Unsupported image extension "${ext}". Allowed: ${Array.from(ALLOWED_EXT).join(', ')}`);
  }
  return ext;
}

async function ensureTemplatesDir() {
  await fs.mkdir(TEMPLATES_DIR, { recursive: true });
}

/** Save buffer to /var/templates with collision-safe name. Returns {filename, absolutePath} */
async function saveBufferToTemplates(buffer, preferredName) {
  await ensureTemplatesDir();
  const base = cleanBaseName(preferredName);
  const ext = assertAllowedExtOrThrow(base);
  const nameNoExt = path.basename(base, ext);

  // collision handling
  let filename = base;
  let abs = path.join(TEMPLATES_DIR, filename);
  let n = 0;
  while (fssync.existsSync(abs)) {
    n += 1;
    filename = `${nameNoExt}-${n}${ext}`;
    abs = path.join(TEMPLATES_DIR, filename);
  }

  await fs.writeFile(abs, buffer, { mode: 0o640 });
  return { filename, absolutePath: abs };
}

async function downloadAttachment(attachment) {
  // attachment: APIAttachment from Discord (has .url, .name, .contentType, .size)
  const { url, name, contentType, size } = attachment;

  if (typeof size === 'number' && size > MAX_TEMPLATE_BYTES) {
    throw new Error(`Attachment too large (${Math.round(size/1024/1024)}MB). Max ${MAX_TEMPLATE_BYTES/1024/1024}MB`);
  }

  const ext = assertAllowedExtOrThrow(name || '');
  // Quick content-type sanity (not strict)
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error(`Attachment content-type is not image/* (${contentType})`);
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download attachment: ${res.status} ${res.statusText}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_TEMPLATE_BYTES) {
    throw new Error(`Downloaded file too large (${Math.round(buf.length/1024/1024)}MB)`);
  }

  // basic magic sniff (PNG/JPEG/WEBP)
  const head = buf.subarray(0, 12).toString('hex');
  const looksImage = head.startsWith('89504e47') || head.startsWith('ffd8ff') || head.includes('57454250');
  if (!looksImage) throw new Error('Attachment does not look like a supported image');

  return { buffer: buf, ext, origName: name || `upload${ext}` };
}

async function assertFileExistsInTemplates(name) {
  const base = cleanBaseName(name);
  const ext = assertAllowedExtOrThrow(base);
  const abs = path.resolve(TEMPLATES_DIR, base);
  const dir = path.resolve(TEMPLATES_DIR);
  if (!abs.startsWith(dir + path.sep) && abs !== dir) {
    throw new Error('Path traversal blocked.');
  }
  await fs.access(abs);
  return { filename: base, absolutePath: abs, ext };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addtemplate')
    .setDescription('Admin: register a new profile template (upload or reference existing file)')
    .setDefaultMemberPermissions('0')
    .addStringOption(o => o.setName('label').setDescription('Display name').setRequired(true))
    .addAttachmentOption(o => o.setName('image').setDescription('Upload image (png/jpg/jpeg/webp)'))
    .addStringOption(o => o.setName('filename').setDescription('Existing file in /var/templates'))
    .addBooleanOption(o => o.setName('active').setDescription('Usable/obtainable? default: true'))
    .addBooleanOption(o => o.setName('boutique').setDescription('Show in /boutique? default: true'))
    .addIntegerOption(o => o.setName('price').setDescription('Price in currency').setMinValue(0))
    .addStringOption(o => o.setName('roles').setDescription('Comma/space-separated Role IDs'))
    .addStringOption(o => o.setName('era').setDescription('Era key required (e.g., S1, Kanto)'))
    .addBooleanOption(o => o.setName('eracomplete').setDescription('Require ALL cards from that era? default: false'))
    .addBooleanOption(o => o.setName('available').setDescription('Freely available w/out checks? default: false')),
  
  async execute(interaction) {
    try {
      if (!interaction.member.roles.cache.has(process.env.MAIN_BYPASS_ID)) {
          return safeReply(interaction, { content: 'You do not have permission to use this command.' });
          }

      const label = interaction.options.getString('label', true).trim();
      const image = interaction.options.getAttachment('image');   // uploaded file (optional)
      const filenameOpt = interaction.options.getString('filename'); // existing (optional)
      const active = interaction.options.getBoolean('active') ?? true;
      const boutiqueVisible = interaction.options.getBoolean('boutique') ?? true;
      const price = interaction.options.getInteger('price') ?? null;
      const rolesRaw = interaction.options.getString('roles');
      const era = interaction.options.getString('era') ?? null;
      const eraComplete = interaction.options.getBoolean('eracomplete') ?? false;
      const available = interaction.options.getBoolean('available') ?? false;

      if (!image && !filenameOpt) {
        return interaction.reply({ ephemeral: true, content: '❌ Provide an image attachment or a filename.' });
      }
      if (image && filenameOpt) {
        return interaction.reply({ ephemeral: true, content: '❌ Choose either an image attachment OR a filename, not both.' });
      }

      let stored = null;

      if (image) {
        await interaction.deferReply({ ephemeral: true }); // downloading can take a second
        const { buffer, ext, origName } = await downloadAttachment(image);

        // name suggestion: label-based + short hash to avoid collisions
        const short = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 6);
        const baseName = cleanBaseName(`${label.replace(/\s+/g, '-').toLowerCase()}-${short}${ext}`);
        stored = await saveBufferToTemplates(buffer, baseName);
      } else {
        stored = await assertFileExistsInTemplates(filenameOpt.trim());
      }

      const roles = rolesRaw ? rolesRaw.split(/[, ]+/).map(s => s.trim()).filter(Boolean) : [];

      const code = await resolveUniqueCode();
      const doc = await Template.create({
        code,
        label,
        filename: stored.filename,
        active,
        boutiqueVisible,
        acquire: {
          price,
          roles,
          requireEra: era,
          requireEraComplete: !!era && eraComplete, // only meaningful if era set
          available
        },
        createdBy: interaction.user.id
      });

      const gates = [];
      if (doc.acquire.available) gates.push('available');
      if (doc.acquire.price != null) gates.push(`price=${doc.acquire.price}`);
      if (doc.acquire.roles?.length) gates.push(`roles=${doc.acquire.roles.length}`);
      if (doc.acquire.requireEra) gates.push(`era=${doc.acquire.requireEra}${doc.acquire.requireEraComplete ? '(complete)' : ''}`);

      const msg =
        `✔️ Template created!\n` +
        `• Code: **${doc.code}**\n` +
        `• Label: **${doc.label}**\n` +
        `• File: \`${doc.filename}\`\n` +
        `• Active: **${doc.active ? 'yes' : 'no'}** | Boutique: **${doc.boutiqueVisible ? 'yes' : 'no'}**\n` +
        `• Acquire gates: ${gates.length ? gates.join(', ') : 'none'}`;

      if (interaction.deferred) {
        await interaction.editReply({ content: msg });
      } else {
        await interaction.reply({ ephemeral: true, content: msg });
      }
    } catch (err) {
      console.error('addtemplate error:', err);
      if (interaction.deferred) {
        return interaction.editReply({ content: `❌ ${err.message}` });
      }
      return interaction.reply({ ephemeral: true, content: `❌ ${err.message}` });
    }
  }
};
