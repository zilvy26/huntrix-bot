require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

const commands = [];

const commandsPath = path.join(__dirname, '../commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if (!command || !command.data || typeof command.data.toJSON !== 'function') {
    console.warn(`⚠️ Skipping "${file}" — missing or invalid 'data.toJSON()'`);
    continue;
  }

  commands.push(command.data.toJSON());
  console.log(`✅ Loaded command: ${command.data.name}`);
}

(async () => {
  try {

    // Step 2: Register fresh guild commands
    console.log('🛠️ Registering guild slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Guild slash commands registered.');

  } catch (error) {
    console.error('❌ Error deploying commands:', error);
  }
})();