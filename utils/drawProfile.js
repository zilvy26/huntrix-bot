// utils/drawProfile.js
const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs/promises');

const Template = require('../models/Template'); // { label, filename, active?, acquire? }
const wrapText = require('../utils/wrapText');
const { TEMPLATES_DIR } = require('../config/storage');
const {
  DEFAULT_TEMPLATE_LABEL = 'Base',
  DEFAULT_TEMPLATE_FILENAME = 'base-bdbdc3.png', // ensure this exists in /var/templates
} = require('../config/profile');

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

async function findTemplateByLabelAny(label) {
  if (!label) return null;
  return Template.findOne(
    { label: { $regex: `^${label}$`, $options: 'i' } },
    { filename: 1, label: 1 }
  ).lean();
}

async function assertFileUnderTemplates(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new Error(`Unsupported template ext: ${ext}`);
  const abs = path.resolve(TEMPLATES_DIR, filename);
  const base = path.resolve(TEMPLATES_DIR);
  if (!abs.startsWith(base + path.sep) && abs !== base) throw new Error('Path traversal blocked');
  await fs.access(abs);
  return abs;
}

async function resolveTemplateFile(profile) {
  let tpl = await findTemplateByLabelAny(profile?.templateLabel);
  if (tpl) {
    try { return await assertFileUnderTemplates(tpl.filename); } catch {/* continue */}
  }
  tpl = await findTemplateByLabelAny(DEFAULT_TEMPLATE_LABEL);
  if (tpl) {
    try { return await assertFileUnderTemplates(tpl.filename); } catch {/* continue */}
  }
  return await assertFileUnderTemplates(DEFAULT_TEMPLATE_FILENAME);
}

module.exports = async function drawProfile(user, profile, favoriteCardImageURL = null) {
  const canvas = createCanvas(1557, 1080);
  const ctx = canvas.getContext('2d');

  // background
  const bgPath = await resolveTemplateFile(profile);
  const background = await loadImage(bgPath);
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

  // avatar
  try {
    const avatarURL = user.displayAvatarURL({ extension: 'png', size: 256 });
    const avatar = await loadImage(avatarURL);
    const x = 119, y = 218, size = 122;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size/2, y + size/2, size/2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, x, y, size, size);
    ctx.restore();
  } catch {}

  // username + stats
  ctx.fillStyle = '#2f1b39';
  ctx.font = '20px "Segoe UI", sans-serif';
  ctx.fillText(`${user.username}`, 400, 225);

  ctx.font = '18px "Segoe UI", sans-serif';
  ctx.fillText(String(profile.patterns ?? 0), 345, 275);
  ctx.fillText(String(profile.sopop ?? 0),    515, 275);

  // bio
  ctx.font = '18px "Segoe UI", sans-serif';
ctx.fillStyle = '#2f1b39';

const bio = (profile.aboutMe && profile.aboutMe.trim()) ? profile.aboutMe : 'No bio set.';

const m = ctx.measureText('Mg|jyÅあ家'); // wide asc/desc coverage
const lineHeight = Math.ceil((m.actualBoundingBoxAscent || 18) + (m.actualBoundingBoxDescent || 5)) + 6;

const box = { x: 120, y: 470, w: 585, h: 440 }; // h = ~11 lines at ~30px

const lines = wrapText(ctx, bio, box.w);

let y = box.y;
for (const line of lines) {
  if (y + lineHeight - box.y > box.h) break; // don’t overrun box; prevents overlap with next section
  ctx.fillText(line, box.x, y);
  y += lineHeight;
}

  // favorite card slot (optional image)
  if (favoriteCardImageURL) {
    try {
      const img = await loadImage(favoriteCardImageURL);
      ctx.drawImage(img, 890, 194, 500, 735);
    } catch {}
  }

  return canvas.toBuffer('image/png');
};
