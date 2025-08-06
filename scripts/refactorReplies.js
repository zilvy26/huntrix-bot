const fs = require('fs');
const path = require('path');

const COMMANDS_DIR = path.resolve(__dirname, '../commands/global');
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

function processFile(fullPath) {
  let contents = fs.readFileSync(fullPath, 'utf8');
  let modified = false;

  // Add safeReply import if missing
  if (!contents.includes('safeReply')) {
    contents = SAFE_REPLY_IMPORT + '\n' + contents;
    modified = true;
  }

  // Replace interaction.reply(...)
  const replyRegex = /interaction\.reply\(([^)]*)\)/g;
  if (replyRegex.test(contents)) {
    contents = contents.replace(replyRegex, 'safeReply(interaction, $1)');
    modified = true;
  }

  // Replace interaction.editReply(...)
  const editReplyRegex = /interaction\.editReply\(([^)]*)\)/g;
  if (editReplyRegex.test(contents)) {
    contents = contents.replace(editReplyRegex, 'safeReply(interaction, $1)');
    modified = true;
  }

  // Save changes
  if (modified) {
    fs.writeFileSync(fullPath, contents, 'utf8');
    console.log(`✅ Updated: ${fullPath}`);
  }
}

console.log('🔍 Scanning for interaction.reply/editReply...');
walkDir(COMMANDS_DIR, processFile);
console.log('🚀 Refactor complete.');