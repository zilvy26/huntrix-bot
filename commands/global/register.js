// commands/global/register.js
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType
} = require('discord.js');
const getOrCreateUser = require('../../utils/getOrCreateUser');
const { safeReply } = require('../../utils/safeReply');

const DISPLAY_TO_DB = {
  MUSIC: 'kpop',
  ANIME: 'anime',
  GAME: 'game',
  FRANCHISE: 'franchise'
};
const DB_TO_DISPLAY = Object.fromEntries(
  Object.entries(DISPLAY_TO_DB).map(([k, v]) => [v, k])
);

const BUTTONS = Object.keys(DISPLAY_TO_DB); // ['MUSIC', 'ANIME', 'GAME', 'FRANCHISE']

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Register a new user or select/update your card category preferences'),

  async execute(interaction) {
    try {
      const user = await getOrCreateUser(interaction);

      const selected = new Set(user.preferredCategories || []);

      const getEmbed = () => {
        const display = selected.size
          ? [...selected].map(cat => DB_TO_DISPLAY[cat] || cat).join(', ')
          : 'All selected, no preferences';

        return new EmbedBuilder()
          .setTitle("Choose Your Card Categories")
          .setDescription("Select the types of cards you'd like to pull from:\n\n"
            + "**MUSIC** — Kpop, Jpop, Tpop, etc.\n"
            + "**ANIME** — Manga, Donghwa, Anime, etc.\n"
            + "**GAME** — Story, Gacha, Fighting, etc.\n"
            + "**FRANCHISE** — Dramas, etc\n\n"
            + `**Preference(s) Selection:** ${display}`)
          .setColor("Purple");
      };

      const getButtons = (disabled = false) =>
        new ActionRowBuilder().addComponents(
          ...BUTTONS.map(btn =>
            new ButtonBuilder()
              .setCustomId(`cat_${btn}`)
              .setLabel(btn)
              .setStyle(ButtonStyle.Primary)
              .setDisabled(disabled)
          )
        );

      const reply = await interaction.reply({
        embeds: [getEmbed()],
        components: [getButtons()],
        ephemeral: true,
        fetchReply: true
      });

      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === interaction.user.id,
        time: 60000
      });

      collector.on('collect', async i => {
        const btnLabel = i.customId.split('_')[1];
        const dbVal = DISPLAY_TO_DB[btnLabel];

        if (selected.has(dbVal)) selected.delete(dbVal);
        else selected.add(dbVal);

        await i.update({
          embeds: [getEmbed()],
          components: [getButtons()]
        });
      });

      collector.on('end', async () => {
        const final = [...selected];
        user.preferredCategories = final;
        await user.save();

        await interaction.editReply({
          embeds: [getEmbed()],
          components: [getButtons(true)]
        });

        await interaction.followUp({
          content: final.length
            ? `Preferences saved: ${final.map(c => DB_TO_DISPLAY[c]).join(', ')}`
            : 'No categories selected, all categories applied.',
          ephemeral: true
        });
      });

    } catch (err) {
      console.error('Error in /register:', err);
      if (!interaction.replied) {
        await safeReply(interaction, {
          content: 'Something went wrong while registering you.',
        });
      }
    }
  }
};
