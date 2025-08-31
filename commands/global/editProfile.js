// commands/editprofile.js
const { SlashCommandBuilder } = require('discord.js');
const UserProfile = require('../../models/UserProfile');
const UserInventory = require('../../models/UserInventory');
const { safeReply } = require('../../utils/safeReply');

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
      option.setName('template_label') // <-- changed from 'template'
        .setDescription('Set your profile template by label (case-insensitive)')
    )
    .addStringOption(option =>
      option.setName('favoritecard')
        .setDescription('Set your favorite card (must own it)')
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const aboutMe = interaction.options.getString('aboutme');
    const templateLabel = interaction.options.getString('template_label'); // new
    const favoriteCard = interaction.options.getString('favoritecard');

    let profile = await UserProfile.findOne({ userId });
    const userData = await require('../../models/User').findOne({ userId });

    if (!profile) {
      profile = new UserProfile({ userId });
    }

    if (aboutMe !== null) profile.aboutMe = aboutMe;

    // set label (no ownership check here; your boutique handles purchase/ownership)
    if (templateLabel !== null) {
      profile.templateLabel = templateLabel.trim();
    }

    if (favoriteCard) {
      const ownsCard = await UserInventory.exists({
        userId,
        'cards.cardCode': favoriteCard.toUpperCase()
      });
      if (!ownsCard) {
        return safeReply(interaction, {
          content: `You don’t own a card with code \`${favoriteCard}\`.`,
        });
      }
      profile.favoriteCard = favoriteCard.toUpperCase();
    }

    await profile.save();
    return safeReply(interaction, { content: 'Your profile has been updated.' });
  }
};
