// commands/editprofile.js
const { SlashCommandBuilder } = require('discord.js');
const UserProfile = require('../../models/UserProfile');
const InventoryItem = require('../../models/InventoryItem'); // ← swapped from UserInventory
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
      option.setName('template_label') // keep label-based template
        .setDescription('Set your profile template by label (case-insensitive)')
    )
    .addStringOption(option =>
      option.setName('favoritecard')
        .setDescription('Set your favorite card (must own it)')
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const aboutMe = interaction.options.getString('aboutme');
    const templateLabel = interaction.options.getString('template_label');
    const favoriteCardInput = interaction.options.getString('favoritecard');

    let profile = await UserProfile.findOne({ userId });
    // (Left as-is if you need it elsewhere)
    // const userData = await require('../../models/User').findOne({ userId });

    if (!profile) {
      profile = new UserProfile({ userId });
    }

    if (aboutMe !== null) {
      profile.aboutMe = aboutMe;
    }

    // set template label exactly as user typed (trim only)
    if (templateLabel !== null) {
      profile.templateLabel = templateLabel.trim();
    }

    // favorite card → must own it in InventoryItem (quantity > 0)
    if (favoriteCardInput) {
      const code = favoriteCardInput.trim().toUpperCase();
      const ownsCard = await InventoryItem.exists({
        userId,
        cardCode: code,
        quantity: { $gt: 0 }
      });

      if (!ownsCard) {
        return safeReply(interaction, {
          content: `You don’t own a card with code \`${favoriteCardInput}\`.`,
        });
      }

      profile.favoriteCard = code;
    }

    await profile.save();
    return safeReply(interaction, { content: 'Your profile has been updated.' });
  }
};
