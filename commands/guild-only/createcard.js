// commands/cards/createcard.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  AttachmentBuilder
} = require('discord.js');

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const Card = require('../../models/Card');
const safeReply = require('../../utils/safeReply');
const generateStars = require('../../utils/starGenerator');
const parseRarity = require('../../utils/parseRarity');
// If you prefer to reuse the same uploader the edit command uses, uncomment the next line
// const uploadCardImage = require('../../utils/imageUploader');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createcard')
    .setDescription('Create a new Huntrix card')
    .setDefaultMemberPermissions('0')
    .addStringOption(opt =>
      opt.setName('cardcode').setDescription('Unique card code (e.g. HTX-001)').setRequired(true))
    .addStringOption(opt =>
      opt.setName('category').setDescription('Card category')
        .addChoices(
          { name: 'KPOP', value: 'kpop' },
          { name: 'ANIME', value: 'anime' },
          { name: 'GAME', value: 'game' },
          { name: 'FRANCHISE', value: 'franchise' },
          { name: 'EVENT', value: 'event' },
          { name: 'ZODIAC', value: 'zodiac' },
          { name: 'OTHERS', value: 'others' }
        ).setRequired(true))
    .addStringOption(opt =>
      opt.setName('rarity')
        .setDescription('Rarity (1–5)')
        .setRequired(true)
        .addChoices(
          { name: '1 Star', value: '1' },
          { name: '2 Stars', value: '2' },
          { name: '3 Stars', value: '3' },
          { name: '4 Stars', value: '4' },
          { name: '5 Stars', value: '5' }
        ))
    .addStringOption(opt => opt.setName('group').setDescription('Card group or pack').setRequired(true))
    .addStringOption(opt =>
      opt.setName('name').setDescription('Card name').setRequired(true))
    .addAttachmentOption(opt =>
      opt.setName('image').setDescription('Upload the card image').setRequired(true))
    .addStringOption(opt =>
      opt.setName('emoji').setDescription('Optional custom emoji (one) to override stars').setRequired(false))
      .addUserOption(opt =>
      opt.setName('designer').setDescription('Card designer').setRequired(false))
    .addUserOption(opt =>
      opt.setName('designer2').setDescription('Optional second designer').setRequired(false))
    .addUserOption(opt =>
      opt.setName('designer3').setDescription('Optional third designer').setRequired(false))
    .addStringOption(opt =>
      opt.setName('era').setDescription('Era or event tag').setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('pullable').setDescription('Is this card available in pulls?').setRequired(false)),

  async execute(interaction) {
    try {
      // Permissions check (same as /editcards)
      const allowedRole = process.env.CARD_CREATOR_ROLE_ID;
      if (!interaction.member.roles.cache.has(allowedRole)) {
        return interaction.editReply({ content: 'You do not have permission to use this command.' });
      }

      const opts = interaction.options;
      const cardCode = opts.getString('cardcode');
      const name = opts.getString('name');
      const category = opts.getString('category');
      const rarityInput = opts.getString('rarity');
      const rarity = parseRarity(rarityInput); // normalized 1–5
      const emoji = opts.getString('emoji') || null;
      const group = opts.getString('group');
      const era = opts.getString('era') || null;
      const pullable = opts.getBoolean('pullable') ?? true;

      // Designers — store as array of IDs (exactly like /editcards)
      const d1 = opts.getUser('designer');
      const d2 = opts.getUser('designer2');
      const d3 = opts.getUser('designer3');
      const designerIds = [d1, d2, d3].filter(Boolean).map(u => u.id);

      // Make sure card code is unique
      if (await Card.findOne({ cardCode })) {
        return interaction.editReply({ content: `A card with code \`${cardCode}\` already exists.` });
      }
      // Save image locally (kept from your original approach; feel free to swap to the same uploader as /editcards)
      const attachment = opts.getAttachment('image');
      const ext = path.extname(attachment.name || '.png');
      const localFilename = `${cardCode}${ext}`;
      const localPath = `/var/cards/${localFilename}`;

      // If using uploadCardImage:
      // const { localPath } = await uploadCardImage(attachment, cardCode);

      const imageResp = await axios.get(attachment.url, { responseType: 'arraybuffer' });
      fs.writeFileSync(localPath, imageResp.data);

      // Build preview embed
      const stars = generateStars({ rarity, overrideEmoji: emoji || undefined });
      const previewEmbed = new EmbedBuilder()
        .setTitle(stars)
        .setColor('Blurple')
        .setImage(`attachment://${localFilename}`)
        .addFields(
          { name: 'Name', value: name, inline: true },
          { name: 'Code', value: cardCode, inline: true },
          { name: 'Category', value: category, inline: true },
          { name: 'Group', value: group || '—', inline: true },
          { name: 'Era', value: era || '—', inline: true },
          {
            name: 'Designer(s)',
            value: (designerIds.length ? designerIds.map(id => `<@${id}>`).join(', ') : 'None'),
            inline: true
          },
          { name: 'Pullable', value: String(pullable), inline: true }
        );

      // Buttons identical style to /editcards
      const confirmBtn = new ButtonBuilder().setCustomId('confirm').setLabel('✅ Confirm').setStyle(ButtonStyle.Success);
      const cancelBtn = new ButtonBuilder().setCustomId('cancel').setLabel('❌ Cancel').setStyle(ButtonStyle.Danger);
      const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

      await safeReply(interaction, {
        embeds: [previewEmbed],
        components: [row],
        files: [new AttachmentBuilder(localPath, { name: localFilename })]
      });
      const msg = await interaction.fetchReply();
      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000 // 2 minutes (same as your old awaitUserButton)
      });

      collector.on('collect', async btn => {
        if (btn.user.id !== interaction.user.id) {
          return btn.reply({ content: 'Only the command invoker can use these buttons.', ephemeral: true });
        }

        // Defer safely (mirrors /editcards style)
        const safeDefer = async () => {
          if (!btn.replied && !btn.deferred) {
            try { await btn.deferUpdate(); } catch { /* noop */ }
          }
        };

        if (btn.customId === 'confirm') {
          collector.stop('confirmed');
          await safeDefer();

          await Card.create({
            cardCode,
            name,
            category,
            rarity,
            emoji,
            designerIds,              // ← array, same as /editcards
            localImagePath: localPath,
            pullable,
            group,
            era
          });

          return interaction.editReply({
            content: `✅ Card \`${cardCode}\` created successfully.`,
            embeds: [],
            components: []
          });
        }

        if (btn.customId === 'cancel') {
          collector.stop('cancelled');
          await safeDefer();
          return interaction.editReply({
            content: '❌ Card creation cancelled.',
            embeds: [],
            components: []
          });
        }
      });

      collector.on('end', async (_, reason) => {
        if (!['confirmed', 'cancelled'].includes(reason)) {
          try {
            const reply = await interaction.fetchReply();
            if (!reply.ephemeral && !reply.deleted) {
              await safeReply(interaction, {
                content: '⏰ Command timed out with no action.',
                embeds: [],
                components: []
              });
            }
          } catch {
            // message likely already handled
          }
        }
      });
    } catch (err) {
      console.error('Error in /createcard:', err);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          content: 'There was an error executing the command.',
          ephemeral: true
        });
      }
    }
  }
};