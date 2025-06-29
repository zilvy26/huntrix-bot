const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const Card = require('../models/Card');
const uploadCardImage = require('../utils/imageUploader');
const awaitUserButton = require('../utils/awaitUserButton');
const generateStars = require('../utils/starGenerator');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createcard')
    .setDescription('Create a new Huntrix card')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addStringOption(opt =>
      opt.setName('cardcode').setDescription('Unique card code (e.g. HTX-001)').setRequired(true))
    .addStringOption(opt =>
      opt.setName('name').setDescription('Card name').setRequired(true))
    .addStringOption(opt =>
      opt.setName('category').setDescription('Card category')
        .addChoices(
          { name: 'KPOP', value: 'kpop' },
          { name: 'ANIME', value: 'anime' },
          { name: 'GAME', value: 'game' },
          { name: 'OTHERS', value: 'others' }
        ).setRequired(true))
    .addStringOption(opt =>
      opt.setName('rarity').setDescription('Rarity (0–5 stars)').setRequired(true))
    .addAttachmentOption(opt =>
      opt.setName('image').setDescription('Upload the card image').setRequired(true))
    .addStringOption(opt =>
      opt.setName('emoji').setDescription('Optional custom emoji (one) to override stars').setRequired(false))
    .addUserOption(opt =>
      opt.setName('designer').setDescription('Card designer').setRequired(false))
    .addStringOption(opt =>
      opt.setName('group').setDescription('Card group or pack').setRequired(false))
    .addStringOption(opt =>
      opt.setName('era').setDescription('Era or event tag').setRequired(false))
    .addBooleanOption(opt =>
  opt.setName('pullable')
     .setDescription('Is this card available in pulls?')
     .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply(); // ✅ Defer early

    try {
      const allowedRole = process.env.CARD_CREATOR_ROLE_ID;
      if (!interaction.member.roles.cache.has(allowedRole)) {
        return interaction.editReply({ content: '🚫 You do not have permission to use this command.' });
      }

      const opts = interaction.options;
      const cardCode = opts.getString('cardcode');
      const name = opts.getString('name');
      const category = opts.getString('category');
      const rarityNum = parseInt(opts.getString('rarity')) || 0;
      const emoji = opts.getString('emoji');
      const designer = opts.getUser('designer') || interaction.user;
      const pullable = opts.getBoolean('pullable') ?? true;
      const group = opts.getString('group');
      const era = opts.getString('era');
      const attachment = opts.getAttachment('image');

      if (await Card.findOne({ cardCode })) {
        return interaction.editReply({ content: `⚠️ A card with code \`${cardCode}\` already exists.` });
      }

      // ✅ Only use the uploader — handles both Discord + Imgur
      const { discordUrl, imgurUrl } = await uploadCardImage(interaction.client, attachment.url, name, cardCode);
      if (!discordUrl) throw new Error('❌ Discord upload failed.');

      const starVisual = emoji
        ? emoji.repeat(Math.min(5, Math.max(0, rarityNum)))
        : generateStars(rarityNum);

      const previewEmbed = new EmbedBuilder()
        .setTitle(`${name} [${cardCode}]`)
        .setColor('Blurple')
        .setImage(discordUrl)
        .addFields(
          { name: 'Category', value: category, inline: true },
          { name: 'Rarity', value: starVisual, inline: true },
          { name: 'Group', value: group || '-', inline: true },
          { name: 'Era', value: era || '-', inline: true },
          { name: 'Designer', value: `<@${designer.id}>`, inline: true },
          { name: 'Imgur Link', value: imgurUrl || '⚠️ Failed', inline: false }
        );

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm').setLabel('Confirm').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
      );

      await interaction.editReply({ embeds: [previewEmbed], components: [confirmRow] });

      const button = await awaitUserButton(interaction, interaction.user, ['confirm', 'cancel'], 60000);

      if (!button) {
        return interaction.editReply({ content: '⌛ No response — cancelled.', components: [] });
      }

      if (button.customId === 'cancel') {
        return button.update({ content: '❌ Cancelled.', embeds: [], components: [] });
      }

      await Card.create({
        cardCode,
        name,
        category,
        rarity: rarityNum,
        group,
        era,
        discordPermalinkImage: discordUrl,
        imgurImageLink: imgurUrl,
        designerId: designer.id,
        pullable
      });

      return button.update({ content: `✅ Card **${name}** [${cardCode}] saved!`, embeds: [], components: [] });

    } catch (err) {
      console.error('❌ Error in /createcard:', err);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({ content: '❌ There was an error executing the command.', ephemeral: true });
      } else {
        return interaction.editReply({ content: '❌ There was an error executing the command.', embeds: [], components: [] });
      }
    }
  }
};