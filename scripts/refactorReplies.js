const fs = require('fs');
const path = require('path');

const COMMANDS_DIR = path.resolve(__dirname, 'commands/global'); // adjust if needed
const SAFE_REPLY_IMPORT = `const safeReply = require('../../utils/safeReply');`;

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(file => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath, callback);
    } else if (file.endsWith('.js')) {
      callback(fullPath);
    }
  });
}

function processFile(filePath) {
  let contents = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Replace reply and editReply with safeReply
  const replyRegex = /await\s+interaction\.(reply|editReply)\s*\(/g;
  if (replyRegex.test(contents)) {
    contents = contents.replace(replyRegex, 'await safeReply(interaction, ');
    modified = true;
  }

  // Ensure safeReply is imported
  if (modified && !contents.includes('safeReply')) {
    const lines = contents.split('\n');
    const insertIndex = lines.findIndex(line =>
      line.startsWith('const') || line.startsWith("'use strict'")
    ) + 1;

    lines.splice(insertIndex, 0, SAFE_REPLY_IMPORT);
    contents = lines.join('\n');
  }

  if (modified) {
    fs.writeFileSync(filePath, contents, 'utf8');
    console.log(`✅ Updated: ${filePath}`);
  }
}

console.log('🔍 Scanning for interaction.reply/editReply...');
walkDir(COMMANDS_DIR, processFile);
console.log('🚀 Refactor complete.');