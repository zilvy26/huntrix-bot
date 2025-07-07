const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('binder')
    .setDescription('Manage your binder')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a card to a binder slot')
        .addIntegerOption(o => o.setName('page').setDescription('Page number (1-3)').setRequired(true))
        .addIntegerOption(o => o.setName('slot').setDescription('Slot number (1-8)').setRequired(true))
        .addStringOption(o => o.setName('code').setDescription('Card code').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a card from a binder slot')
        .addIntegerOption(o => o.setName('page').setDescription('Page number (1-3)').setRequired(true))
        .addIntegerOption(o => o.setName('slot').setDescription('Slot number (1-8)').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View a page of your binder or someone else’s')
        .addIntegerOption(o => o.setName('page').setDescription('Page number (1-3)').setRequired(false))
        .addUserOption(o => o.setName('user').setDescription('User to view').setRequired(false))
),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') return require('./subcommands/binderAdd')(interaction);
    if (sub === 'remove') return require('./subcommands/binderRemove')(interaction);
    if (sub === 'view') return require('./subcommands/binderView')(interaction);
  }
};