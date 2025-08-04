// commands/profile_edit.js

const { SlashCommandBuilder } = require('discord.js');
const UserProfile = require('../../models/UserProfile');
const UserInventory = require('../../models/UserInventory');
const templateOptions = require('../../data/templateOptions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editprofile')
    .setDescription('Edit your profile')
    .addStringOption(option =>
      option.setName('aboutme')
        .setDescription('Write something about yourself')
        .setMaxLength(400)
    )
    .addStringOption(option =>
      option.setName('template')
        .setDescription('Select a profile template')
        .addChoices(
  { name: 'Profile Base (default)', value: 'profile_base' },
  ...templateOptions.map(t => ({ name: t.name, value: t.id }))
)
    )
    .addStringOption(option =>
      option.setName('favoritecard')
        .setDescription('Set your favorite card (must own it)')
    ),

  async execute(interaction) {
  await interaction.deferReply();

  const userId = interaction.user.id;
  const aboutMe = interaction.options.getString('aboutme');
  const template = interaction.options.getString('template');
  const favoriteCard = interaction.options.getString('favoritecard');

  let profile = await UserProfile.findOne({ userId });
  const userData = await require('../../models/User').findOne({ userId });

  if (!profile) {
    profile = new UserProfile({ userId });
  }

  if (aboutMe !== null) profile.aboutMe = aboutMe;

  if (template !== null) {
    // Always allow fallback to base
    if (template !== 'profile_base') {
      if (!userData?.templatesOwned?.includes(template)) {
        return interaction.editReply({
          content: `You don’t own the template \`${template}\`. Use /boutique decors to buy it.`,
        });
      }
    }

    profile.template = template;
  }

  if (favoriteCard) {
    const ownsCard = await UserInventory.exists({
      userId,
      'cards.cardCode': favoriteCard.toUpperCase()
    });

    if (!ownsCard) {
      return interaction.editReply({
        content: `You don’t own a card with code \`${favoriteCard}\`.`,
      });
    }

    profile.favoriteCard = favoriteCard.toUpperCase();
  }

  await profile.save();

  return interaction.editReply({
    content: 'Your profile has been updated.',
  });
}
};