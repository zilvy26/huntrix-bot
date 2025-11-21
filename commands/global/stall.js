const { SlashCommandBuilder } = require('discord.js');
const handlePreview = require('./subcommands/stallpreview');
const handleSell = require('./subcommands/stallsell');
const handleBuy = require('./subcommands/stallbuy');
const handleRemove = require('./subcommands/stallremove');
const handleDelete = require('./subcommands/stalldelete');
const {safeReply} = require('../../utils/safeReply');
const { trusted } = require('mongoose');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stall')
    .setDescription('Marketplace command group')
    .addSubcommand(sub =>
      sub.setName('preview')
        .setDescription('Browse cards listed on the market')
        .addBooleanOption(o => o.setName('compact').setDescription('Compact list (no images)').setRequired(true))
        .addStringOption(o => o.setName('name').setDescription('Name, comma-separated for multiple'))
        .addStringOption(o => o.setName('group').setDescription('Group, comma-separated for multiple'))
        .addStringOption(o => o.setName('era').setDescription('Era, comma-separated for multiple'))
        .addStringOption(o => o.setName('rarities').setDescription('Rarity spec: 1 or 1,3 or 1-4 or 1,3-5'))
// keep legacy too if you want backward compatibility
        .addBooleanOption(o => o.setName('unowned').setDescription('Only show cards you do not own'))
        .addBooleanOption(o => o.setName('cheapest').setDescription('Sort by cheapest first'))
        .addBooleanOption(o => o.setName('newest').setDescription('Sort by newest first'))
        .addUserOption(o => o.setName('seller').setDescription('Only show this seller'))
        .addIntegerOption(o => o.setName('per_page').setDescription('Listings per page (1-6)'))
        .addIntegerOption(o => o.setName('page').setDescription('Start page'))
    )
    // in your stall command registration
    .addSubcommand(sub =>
  sub
    .setName('sell')
    .setDescription('List cards on the market')
    .addStringOption(opt =>
      opt.setName('cardcode')
        .setDescription('Codes to sell (multi, +qty)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('price')
        .setDescription('Single price or list matching codes')
        .setRequired(true)
    )
)
    .addSubcommand(sub =>
      sub.setName('buy')
        .setDescription('Buy a listed card using its Buy Code')
        .addStringOption(opt =>
          opt.setName('buycode').setDescription('Buy Code(s) — comma-separated for multiple').setRequired(true))
    )
    .addSubcommand(sub =>
  sub.setName('remove')
    .setDescription('Remove one of your listings from the market')
    .addStringOption(opt =>
      opt.setName('buycode').setDescription('Remove listing(s) — comma-separated for multiple').setRequired(true))
    )

    .addSubcommand(sub =>
  sub.setName('delete')
    .setDescription('Force-delete listing(s) as an admin')

    .addStringOption(opt =>
      opt.setName('buycode')
        .setDescription('Buy Code(s) — comma-separated')
        .setRequired(true)
    )
),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'preview') return await handlePreview(interaction);
      if (sub === 'sell') return await handleSell(interaction);
      if (sub === 'buy') return await handleBuy(interaction);
      if (sub === 'remove') return await handleRemove(interaction);
      if (sub === 'delete') return await handleDelete(interaction);

      return safeReply(interaction, { content: `Unknown subcommand: ${sub}` });
    } catch (err) {
      console.error(`[STALL/${sub}] Error:`, err);
      return safeReply(interaction, { content: `Something went wrong.` });
    }
  }
};