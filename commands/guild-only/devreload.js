const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('devreload')
    .setDescription('Reload command logic (dev only)'),
  async execute(interaction) {
    const commandFolders = ['global', 'guild-only'];
    let reloaded = [];

    for (const folder of commandFolders) {
      const folderPath = path.join(__dirname, '..', folder);
      const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.js'));

      for (const file of files) {
        const filePath = path.join(folderPath, file);
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

    await interaction.reply(`♻️ Reloaded commands: ${reloaded.join(', ')}`);
  }
};