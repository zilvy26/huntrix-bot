const safeReply = require('../../utils/safeReply');
const { SlashCommandBuilder } = require('discord.js');

// Import subcommand logic modules
const boutiqueCards = require('./subcommands/boutiqueCards');
const boutiquePreview = require('./subcommands/boutiquePreview');
const boutiqueDecors = require('./subcommands/boutiqueDecors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('boutique')
    .setDescription('Access the boutique store')
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
            .setDescription('Comma‑separated groups')
        )
        .addStringOption(opt =>
          opt.setName('names')
            .setDescription('Comma‑separated names')
        )
        .addStringOption(opt =>
          opt.setName('eras')
            .setDescription('Comma‑separated eras')
        )
    )
    .addSubcommand(sub =>
      sub.setName('preview')
        .setDescription('Preview boutique offerings')
    )
    .addSubcommand(sub =>
      sub.setName('decors')
        .setDescription('Buy profile templates with sopop')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'cards') {
      return boutiqueCards(interaction);
    } else if (sub === 'preview') {
      return boutiquePreview(interaction);
    } else if (sub === 'decors') {
      return boutiqueDecors(interaction);
    }
  }
};