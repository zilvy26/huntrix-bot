// commands/global/register.js
const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const getOrCreateUser = require('../../utils/getOrCreateUser');
const { safeReply } = require('../../utils/safeReply');

const CATEGORY_MAP = {
  MUSIC: 'kpop',
  ANIME: 'anime',
  GAME: 'game',
  FRANCHISE: 'franchise'
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Register a new user for Huntrix'),

  async execute(interaction) {
    const user = await getOrCreateUser(interaction);
    const initial = new Set(user.preferredCategories ?? []);
    const allLabels = Object.keys(CATEGORY_MAP);

    const embed = new EmbedBuilder()
      .setTitle(`Welcome, ${user.username}!`)
      .setDescription('Toggle your preferred card categories below.\nIf none are selected, all categories will be available by default.')
      .addFields({
        name: 'Current Preferences',
        value: initial.size
          ? [...initial].map(cat => `• ${cat}`).join('\n')
          : '_All categories (default)_'
      })
      .setColor(0xffcc99);

    const row = new ActionRowBuilder().addComponents(
      ...allLabels.map(label =>
        new ButtonBuilder()
          .setCustomId(`catpref:${CATEGORY_MAP[label]}`)
          .setLabel(label)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(false)
      )
    );

    await safeReply(interaction, {
      embeds: [embed],
      components: [row]
    });
  }
};
