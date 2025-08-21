// scripts/codemod-fix-acks.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CMD_DIR = path.join(ROOT, 'commands');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = fs.statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

function ensureSafeReplyImport(src, filePath) {
  if (src.includes("require('../../utils/safeReply'") || src.includes("require('../utils/safeReply'")) {
    return src; // already imported
  }
  // figure out relative path from commands/<folder>/
  const rel = filePath.includes(path.sep + 'commands' + path.sep + 'global' + path.sep)
    ? "../../utils/safeReply"
    : filePath.includes(path.sep + 'commands' + path.sep + 'guild-only' + path.sep)
    ? "../../utils/safeReply"
    : "../utils/safeReply"; // fallback

  // add after first require line
  const lines = src.split('\n');
  let inserted = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('const ') && lines[i].includes('require(')) {
      lines.splice(i + 1, 0, `const safeReply = require('${rel}');`);
      inserted = true;
      break;
    }
  }
  if (!inserted) lines.unshift(`const safeReply = require('${rel}');`);
  return lines.join('\n');
}

function transform(src, filePath) {
  let out = src;

  // 1) Remove any deferReply() in commands (handler defers)
  out = out.replace(/\s*await\s*interaction\.deferReply\s*\([^)]*\)\s*;?/g, '');

  // 2) Replace reply/editReply/followUp with safeReply
  out = out.replace(/await\s*interaction\.reply\s*\(/g, 'await safeReply(interaction, ');
  out = out.replace(/await\s*interaction\.editReply\s*\(/g, 'await safeReply(interaction, ');
  out = out.replace(/await\s*interaction\.followUp\s*\(/g, 'await safeReply(interaction, ');

  // 3) Ensure import exists
  out = ensureSafeReplyImport(out, filePath);

  return out;
}

const files = walk(CMD_DIR);
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const newSrc = transform(src, f);
  if (newSrc !== src) {
    fs.writeFileSync(f + '.bak', src);
    fs.writeFileSync(f, newSrc);
    console.log('✅ updated', path.relative(ROOT, f));
  }
}
console.log('Done. Backups saved as *.bak');