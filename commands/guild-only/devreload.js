const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
  .setName('devreload')
  .setDescription('Reload command logic (dev only)')
  .addStringOption(opt =>
    opt.setName('command')
      .setDescription('Specific command to reload (leave blank to reload all)')
      .setRequired(false)
  )
  .setDefaultMemberPermissions('0'),
  async execute(interaction) {
    if (interaction.user.id !== process.env.MAIN_BYPASS_ID) {
    return interaction.reply({ content: 'You do not have permission to use this command.' });
    }

    const target = interaction.options.getString('command');
const commandFolders = ['global', 'guild-only'];
let reloaded = [];

for (const folder of commandFolders) {
  const folderPath = path.join(__dirname, '..', folder);
  const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const filePath = path.join(folderPath, file);
    const cmdName = path.parse(file).name;

    if (target && cmdName !== target) continue;

    delete require.cache[require.resolve(filePath)];
    try {
      const cmd = require(filePath);
      interaction.client.commands.set(cmd.data.name, cmd);
      reloaded.push(cmd.data.name);
    } catch (err) {
      console.error(`❌ Failed to reload ${file}:`, err);
    }
  }
}

    if (reloaded.length === 0) {
  return interaction.reply(`❗ No command reloaded. Command "${target}" may not exist.`);
}

await interaction.reply(`♻️ Reloaded command${reloaded.length > 1 ? 's' : ''}: ${reloaded.join(', ')}`);
  }
};