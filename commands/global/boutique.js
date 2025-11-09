// commands/boutique/index.js
const { SlashCommandBuilder } = require('discord.js');

// Import subcommand logic modules
const boutiqueCards = require('./subcommands/boutiqueCards');
const boutiquePreview = require('./subcommands/boutiquePreview');
const boutiqueTemplate = require('./subcommands/boutiqueTemplate');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('boutique')
    .setDescription('Access the boutique store')

    // Buy cards flow (unchanged)
    .addSubcommand(sub =>
      sub.setName('cards')
        .setDescription('Buy cards from Boutique')
        .addStringOption(opt =>
          opt.setName('shop')
            .setDescription('Choose a shop pull type')
            .setRequired(true)
            .addChoices(
              { name: '20x Random & Guaranteed 5S', value: 'random20' },
              { name: '10x Cards of Choice', value: 'choice10' },
              { name: '1x Zodiac Pull', value: 'zodiac1' },
              { name: '1x Event Pull', value: 'event1' }
            )
        )
        .addIntegerOption(opt =>
          opt.setName('amount')
            .setDescription('How many pulls (1–50)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(50)
        )
        .addStringOption(opt =>
          opt.setName('groups')
            .setDescription('Comma-separated groups')
        )
        .addStringOption(opt =>
          opt.setName('names')
            .setDescription('Comma-separated names')
        )
        .addStringOption(opt =>
          opt.setName('eras')
            .setDescription('Comma-separated eras')
        )
    )

    // Preview flow (NOW with a type selector)
    .addSubcommand(sub =>
      sub.setName('preview')
        .setDescription('Preview boutique prices')
        .addStringOption(o =>
          o.setName('type')
            .setDescription('What to preview')
            .setRequired(true)
            .addChoices(
              { name: 'Cards', value: 'cards' },
              { name: 'Templates', value: 'templates' },
            )
        )
    )

    // Buy/claim a template by label (unchanged)
    .addSubcommand(sub =>
      sub.setName('template')
        .setDescription('Buy/claim a template by label')
        .addStringOption(o =>
          o.setName('label')
            .setDescription('Template label (case-insensitive)')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'cards') {
      return boutiqueCards(interaction);
    } else if (sub === 'preview') {
      return boutiquePreview(interaction);
    } else if (sub === 'template') {
      return boutiqueTemplate(interaction);
    }
  }
};
