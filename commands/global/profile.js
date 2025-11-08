// commands/profile.js
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const UserProfile = require('../../models/UserProfile');
const InventoryItem = require('../../models/InventoryItem'); // ✅ new inventory
const Card = require('../../models/Card');
const User = require('../../models/User');
const drawProfile = require('../../utils/drawProfile');
const { safeReply } = require('../../utils/safeReply');
const { DEFAULT_TEMPLATE_LABEL } = require('../../config/profile');
const { ensureDefaultTemplate } = require('../../services/templateInventory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription("View your profile or another user's")
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user whose profile you want to view')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const user = await interaction.client.users.fetch(targetUser.id);

    // Ensure profile exists (same as before)
    let profile = await UserProfile.findOne({ userId: user.id });
    if (!profile) {
      profile = await UserProfile.create({
        userId: user.id,
        aboutMe: '',
        favoriteCard: null,
        badges: [],
        template: 'profile_base',
        templateLabel: DEFAULT_TEMPLATE_LABEL,
      });
    } else if (!profile.templateLabel) {
      profile.templateLabel = DEFAULT_TEMPLATE_LABEL;
      await profile.save();
    }

    await ensureDefaultTemplate(user.id);

    // Currency from User model (unchanged)
    const userData = await User.findOne({ userId: user.id });
    const patterns = userData?.patterns || 0;

    // Favorite card lookup using InventoryItem
    let favoriteCardImageURL = null;
    if (profile.favoriteCard) {
      const hasCard = await InventoryItem.exists({
        userId: user.id,
        cardCode: profile.favoriteCard,
        quantity: { $gt: 0 },
      });

      const card = await Card.findOne({ cardCode: profile.favoriteCard });
      if (hasCard && card) {
        favoriteCardImageURL = card.localImagePath
          ? card.localImagePath
          : (card.discordPermalinkImage || card.imgurImageLink || null);
      }
    }

    try {
      const buffer = await drawProfile(
        user,
        { ...profile.toObject(), patterns},
        favoriteCardImageURL
      );
      const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });
      await safeReply(interaction, { files: [attachment] });
    } catch (error) {
      console.error("Error generating profile:", error);
      await safeReply(interaction, { content: "There was an error generating the profile image." });
    }
  }
};