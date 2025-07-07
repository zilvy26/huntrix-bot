const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const UserProfile = require('../models/UserProfile');
const UserInventory = require('../models/UserInventory');
const Card = require('../models/Card');
const User = require('../models/User');
const drawProfile = require('../utils/drawProfile');

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
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('user') || interaction.user;
    const user = await interaction.client.users.fetch(targetUser.id);

    // Retrieve or initialize profile
    let profile = await UserProfile.findOne({ userId: user.id });
    if (!profile) {
      profile = await UserProfile.create({
        userId: user.id,
        bio: '',
        favoriteCard: null,
        badges: [],
        template: 'profile_base'
      });
    }

    // Currency from User model
    const userData = await User.findOne({ userId: user.id });
    const patterns = userData?.patterns || 0;
    const sopop = userData?.sopop || 0;

    // Favorite card logic
    let favoriteCardImageURL = null;
    if (profile.favoriteCard) {
      const inventoryEntry = await UserInventory.findOne({
        userId: user.id,
        'cards.cardCode': profile.favoriteCard
      });

      const card = await Card.findOne({ cardCode: profile.favoriteCard });

      if (inventoryEntry && card) {
        if (card.imgurImageLink?.startsWith('http')) {
          favoriteCardImageURL = card.imgurImageLink;
        } else if (card.discordPermalinkImage?.startsWith('http')) {
          favoriteCardImageURL = card.discordPermalinkImage;
        } else {
          console.warn("No valid image URL found for favoriteCard:", profile.favoriteCard);
        }
      } else {
        console.warn("Inventory entry or card not found for favoriteCard:", profile.favoriteCard);
      }
    }

    try {
      const buffer = await drawProfile(user, {
        ...profile.toObject(),
        patterns,
        sopop
      }, favoriteCardImageURL);

      const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });
      await interaction.editReply({ files: [attachment] });
    } catch (error) {
      console.error("Error generating profile:", error);
      await interaction.editReply({ content: "There was an error generating the profile image." });
    }
  }
};