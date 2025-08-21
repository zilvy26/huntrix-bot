// commands/global/createcard.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const safeReply = require('../../utils/safeReply'); // compat helper
const Card = require('../../models/Card');
const awaitUserButton = require('../../utils/awaitUserButton');
const generateStars = require('../../utils/starGenerator');
const parseRarity = require('../../utils/parseRarity');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createcard')
    .setDescription('Create a new Huntrix card')
    // keep your role-gate check in code; default perms can stay zero
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
    .addStringOption(opt => opt.setName('name').setDescription('Card name').setRequired(true))
    .addAttachmentOption(opt => opt.setName('image').setDescription('Upload the card image').setRequired(true))
    .addStringOption(opt => opt.setName('emoji').setDescription('Optional custom emoji (one) to override stars'))
    .addUserOption(opt => opt.setName('designer').setDescription('Card designer'))
    .addUserOption(opt => opt.setName('designer2').setDescription('Optional second designer'))
    .addUserOption(opt => opt.setName('designer3').setDescription('Optional third designer'))
    .addStringOption(opt => opt.setName('era').setDescription('Era or event tag'))
    .addBooleanOption(opt => opt.setName('pullable').setDescription('Is this card available in pulls?')),

  async execute(interaction) {
    try {
      // permissions: role gate
      const allowedRole = process.env.CARD_CREATOR_ROLE_ID;
      if (!interaction.member?.roles?.cache?.has(allowedRole)) {
        return safeReply(interaction, { content: 'You do not have permission to use this command.' });
      }
      const opts = interaction.options;
      const cardCode = opts.getString('cardcode');
      const name = opts.getString('name');
      const category = opts.getString('category');
      const rarityInput = opts.getString('rarity');
      const rarity = parseRarity(rarityInput); // 1–5 expected
      const emoji = opts.getString('emoji');
      const designer1 = opts.getUser('designer') || interaction.user;
      const designer2 = opts.getUser('designer2');
      const designer3 = opts.getUser('designer3');

      const designerIds = [designer1, designer2, designer3].filter(Boolean).map(u => `${u.id}`).join(', ');
      const pullable = opts.getBoolean('pullable') ?? true;
      const group = opts.getString('group');
      const era = opts.getString('era');
      const attachment = opts.getAttachment('image');

      // duplicate code check
      if (await Card.findOne({ cardCode })) {
        return safeReply(interaction, { content: `A card with code \`${cardCode}\` already exists.` });
      }

      // Save image locally
      const ext = path.extname(attachment.name || '.png');
      const localFilename = `${cardCode}${ext}`;
      const localPath = `/var/cards/${localFilename}`;

      const imageResp = await axios.get(attachment.url, { responseType: 'arraybuffer' });
      fs.writeFileSync(localPath, imageResp.data);

      // Preview embed
      const stars = generateStars({ rarity, overrideEmoji: emoji });
      const previewEmbed = new EmbedBuilder()
        .setTitle(stars)
        .setColor('Blurple')
        .setImage(`attachment://${localFilename}`)
        .addFields(
          { name: 'Name', value: name, inline: true },
          { name: 'Code', value: cardCode, inline: true },
          { name: 'Category', value: category, inline: true },
          { name: 'Group', value: group || '-', inline: true },
          { name: 'Era', value: era || '-', inline: true },
          { name: 'Designer(s)', value: designerIds || '-', inline: true }
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm').setLabel('Confirm').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
      );

      await safeReply(interaction, {
        embeds: [previewEmbed],
        components: [row],
        files: [{ attachment: localPath, name: localFilename }]
      });

      // Wait for confirm/cancel
      const btn = await awaitUserButton(interaction, interaction.user.id, ['confirm', 'cancel'], 120000);

      if (!btn) {
        return safeReply(interaction, { content: 'No response — cancelled.', components: [] });
      }

      if (!btn.deferred && !btn.replied) {
        try { await btn.deferUpdate(); } catch (err) { console.warn('Failed to defer update:', err); }
      }

      if (btn.customId === 'confirm') {
        await Card.create({
          cardCode, name, category, rarity,
          emoji: emoji || null,
          designerIds,
          localImagePath: localPath,
          pullable, group, era
        });

        return safeReply(interaction, {
          content: `Card \`${cardCode}\` created successfully.`,
          embeds: [],
          components: []
        });
      }

      return safeReply(interaction, { content: 'Card creation cancelled.', components: [] });
    } catch (err) {
      console.error('Error in /createcard:', err);
      return safeReply(interaction, { content: 'There was an error executing the command.', ephemeral: true });
    }
  }
};