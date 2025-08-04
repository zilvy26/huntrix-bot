// commands/global/help.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('View all available bot commands grouped by category'),

  async execute(interaction) {
    const commandsDir = path.join(__dirname, '..');
    const adminCommands = [];
    const publicCommands = [];

    for (const folder of fs.readdirSync(commandsDir)) {
      const folderPath = path.join(commandsDir, folder);
      if (!fs.statSync(folderPath).isDirectory()) continue;

      const isAdmin = folder === 'guild-only';

      for (const file of fs.readdirSync(folderPath).filter(f => f.endsWith('.js'))) {
        const command = require(path.join(folderPath, file));
        if (!command.data) continue;

        const entry = {
          name: `/${command.data.name}`,
          description: command.data.description || 'No description provided'
        };

        if (isAdmin) adminCommands.push(entry);
        else publicCommands.push(entry);
      }
    }

    const pages = [
      buildHelpEmbed('Public Commands', publicCommands),
      buildHelpEmbed('Admin Commands', adminCommands)
    ];

    let page = 0;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary).setEmoji({ id: '1390462706544410704', name: ':ehx_rightarrow' }),
    );

    await interaction.reply({ embeds: [pages[0]], components: [row] });
    const msg = await interaction.fetchReply();

    const collector = msg.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      time: 60_000
    });

    collector.on('collect', async i => {
      page = i.customId === 'next' ? (page + 1) % pages.length : (page - 1 + pages.length) % pages.length;
      await i.update({ embeds: [pages[page]], components: [row] });
    });

    collector.on('end', () => msg.edit({ components: [] }));
  }
};

function buildHelpEmbed(title, commands) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(title.includes('Admin') ? 'Red' : 'Green')
    .setDescription(
      commands.length
        ? commands.map(cmd => `**${cmd.name}** — ${cmd.description}`).join('\n')
        : '_No commands available._'
    )
    .setFooter({ text: 'Join the Discord Support Server : https://discord.gg/huntrixbot' });
}