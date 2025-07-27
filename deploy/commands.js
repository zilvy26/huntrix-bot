require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TOKEN = process.env.TOKEN;
const rest = new REST({ version: '10' }).setToken(TOKEN);

// At the top of deploy-commands.js

const COMMAND_ROLE_MAP = {
  grantcard: ['1389690375068848188'],
  grantpay: ['1389690375068848188'],
  grantrandom: ['1389690375068848188'],
  createcard: ['1387058906588778657'],
  addquestion: ['1387058906588778657'],
  editcard: ['1387058906588778657'],
  maintenance: ['1386797486680703036'],
  createcode: ['1386797486680703036'],
  devreload: ['1386797486680703036']
};

// Load global and guild commands separately
async function loadCommands() {
  const globalCommands = [];
  const guildCommands = [];

  const loadFromFolder = (folder, collector) => {
    const cmdDir = path.join(__dirname, '..', 'commands', folder);
    if (!fs.existsSync(cmdDir)) return;
    const files = fs.readdirSync(cmdDir).filter(file => file.endsWith('.js'));

    for (const file of files) {
      const command = require(path.join(cmdDir, file));
      if (command && command.data && typeof command.data.toJSON === 'function') {
        collector.push(command.data.toJSON());
      }
    }
  };

  loadFromFolder('global', globalCommands);
  loadFromFolder('guild-only', guildCommands);

  try {
    // 🌐 Register global commands
    console.log('🌍 Registering global commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: globalCommands });
    console.log('✅ Global commands registered.');

    console.log('🧹 Cleaning up stale global commands...');
    const liveCommands = await rest.get(Routes.applicationCommands(CLIENT_ID));
    const deployedNames = new Set(globalCommands.map(c => c.name));

  for (const cmd of liveCommands) {
    if (!deployedNames.has(cmd.name)) {
      await rest.delete(Routes.applicationCommand(CLIENT_ID, cmd.id));
      console.log(`🗑 Removed stale global command: ${cmd.name}`);
  }
}

    // 🏠 Register guild-only commands
    console.log('🏠 Registering guild-only commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: guildCommands });
    console.log('✅ Guild-only commands registered.');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }

  const RESTRICTED_ROLE_ID = 'YOUR_ADMIN_OR_MOD_ROLE_ID_HERE'; // ⬅️ Add this

// ...existing code to register guild commands...

// Add after registering guild-only commands:
console.log('🔐 Applying per-command role restrictions...');

for (const cmd of registeredGuildCmds) {
  const allowedRoles = COMMAND_ROLE_MAP[cmd.name];
  if (!allowedRoles) {
    console.warn(`⚠️ No roles set for command: ${cmd.name}`);
    continue;
  }

  await rest.put(
    Routes.applicationCommandPermissions(CLIENT_ID, GUILD_ID, cmd.id),
    {
      body: allowedRoles.map(roleId => ({
        id: roleId,
        type: 2, // Role
        permission: true
      }))
    }
  );

  console.log(`🔒 Restricted "${cmd.name}" to roles: ${allowedRoles.join(', ')}`);
}
}

loadCommands();