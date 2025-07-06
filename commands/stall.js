const { SlashCommandBuilder } = require('discord.js');
const handlePreview = require('./subcommands/stallpreview');
const handleSell = require('./subcommands/stallsell');
const handleBuy = require('./subcommands/stallbuy');
const handleRemove = require('./subcommands/stallremove');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stall')
    .setDescription('Marketplace command group')
    .addSubcommand(sub =>
      sub.setName('preview')
        .setDescription('Browse cards listed on the market')
        .addStringOption(opt =>
          opt.setName('group').setDescription('Group filter'))
        .addStringOption(opt =>
          opt.setName('name').setDescription('Card name filter'))
        .addStringOption(opt =>
          opt.setName('rarity').setDescription('Rarity filter'))
        .addStringOption(opt =>
          opt.setName('era').setDescription('Era filter'))
        .addStringOption(opt =>
          opt.setName('seller').setDescription('Seller ID filter'))
        .addBooleanOption(opt =>
          opt.setName('unowned').setDescription('Only show cards you don’t own'))
        .addBooleanOption(opt =>
          opt.setName('cheapest').setDescription('Sort by cheapest'))
        .addBooleanOption(opt =>
          opt.setName('newest').setDescription('Sort by newest'))
        .addIntegerOption(opt =>
          opt.setName('page').setDescription('Page number'))
    )
    .addSubcommand(sub =>
      sub.setName('sell')
        .setDescription('List one of your cards on the market')
        .addStringOption(opt =>
          opt.setName('cardcode').setDescription('Code of card to sell').setRequired(true))
        .addIntegerOption(opt =>
          opt.setName('price').setDescription('Sale price').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('buy')
        .setDescription('Buy a listed card using its Buy Code')
        .addStringOption(opt =>
          opt.setName('buycode').setDescription('Buy Code of the card').setRequired(true))
    )
    .addSubcommand(sub =>
  sub.setName('remove')
    .setDescription('Remove one of your listings from the market')
    .addStringOption(opt =>
      opt.setName('buycode').setDescription('Buy Code of your listing').setRequired(true))
),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'preview') return await handlePreview(interaction);
      if (sub === 'sell') return await handleSell(interaction);
      if (sub === 'buy') return await handleBuy(interaction);
      if (sub === 'remove') return await handleRemove(interaction);

      return interaction.reply({ content: `Unknown subcommand: ${sub}` });
    } catch (err) {
      console.error(`[STALL/${sub}] Error:`, err);
      return interaction.reply({ content: `❌ Something went wrong.` });
    }
  }
};