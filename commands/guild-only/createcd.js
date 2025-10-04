// commands/cds/createcd.js
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

const CD = require('../../models/CD');
const { safeReply } = require('../../utils/safeReply');

/**
 * Notes:
 * - Mirrors your /createcard UX: permission check, preview embed, confirm/cancel buttons, timed collector.
 * - Stores the image locally like your card command and persists the absolute path in Mongo.
 * - Role gate: set CD_CREATOR_ROLE_ID in env (falls back to CARD_CREATOR_ROLE_ID if missing).
 */

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createcd')
    .setDescription('Create a new CD entry')
    .setDefaultMemberPermissions('0')
    .addStringOption(opt =>
      opt.setName('title')
        .setDescription('Title to identify the CD (must be unique)')
        .setRequired(true))
    .addAttachmentOption(opt =>
      opt.setName('image')
        .setDescription('Upload the CD image')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('active_era')
        .setDescription('Active era label (e.g. 2025 Summer)')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('inactive_era')
        .setDescription('Inactive era label')
        .setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('available')
        .setDescription('Is this CD available to obtain?')
        .setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('active')
        .setDescription('If true: requires active era only; if false: requires both active + inactive era')
        .setRequired(false)),

  async execute(interaction) {
    try {
      // Permissions (mirrors your /createcard style) :contentReference[oaicite:1]{index=1}
      const roleId = process.env.CD_CREATOR_ROLE_ID || process.env.CARD_CREATOR_ROLE_ID;
      if (!roleId || !interaction.member.roles.cache.has(roleId)) {
        return interaction.editReply({ content: 'You do not have permission to use this command.' });
      }

      const opts = interaction.options;
      const title = opts.getString('title', true);
      const attachment = opts.getAttachment('image', true);
      const activeEra = opts.getString('active_era') || null;
      const inactiveEra = opts.getString('inactive_era') || null;
      const available = opts.getBoolean('available') ?? true;
      const active = opts.getBoolean('active') ?? true;

      // Ensure unique title
      if (await CD.findOne({ title })) {
        return interaction.editReply({ content: `A CD titled **${title}** already exists.` });
      }

      // Save image locally (same pattern as your card creation) :contentReference[oaicite:2]{index=2}
      const ext = path.extname(attachment.name || '.png');
      const safeName = title.replace(/[^a-z0-9_\-]+/gi, '_');
      const localFilename = `${safeName}${ext}`;
      const localDir = '/var/cds';
      const localPath = path.join(localDir, localFilename);

      if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });

      const imageResp = await axios.get(attachment.url, { responseType: 'arraybuffer' });
      fs.writeFileSync(localPath, imageResp.data);

      // Friendly description for "active" logic
      const requirement = active
        ? 'Requires **Active Era only**'
        : 'Requires **both Active Era and Inactive Era**';

      // Build preview embed (mirrors your confirm/cancel UX) :contentReference[oaicite:3]{index=3}
      const previewEmbed = new EmbedBuilder()
        .setTitle(`CD Preview: ${title}`)
        .setColor('Blurple')
        .setImage(`attachment://${localFilename}`)
        .addFields(
          { name: 'Title', value: title, inline: true },
          { name: 'Available', value: String(available), inline: true },
          { name: 'Requirement', value: requirement, inline: true },
          { name: 'Active Era', value: activeEra || '—', inline: true },
          { name: 'Inactive Era', value: inactiveEra || '—', inline: true },
          { name: 'Created By', value: `<@${interaction.user.id}>`, inline: true }
        );

      const confirmBtn = new ButtonBuilder()
        .setCustomId('confirm')
        .setLabel('✅ Confirm')
        .setStyle(ButtonStyle.Success);

      const cancelBtn = new ButtonBuilder()
        .setCustomId('cancel')
        .setLabel('❌ Cancel')
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

      await safeReply(interaction, {
        embeds: [previewEmbed],
        components: [row],
        files: [new AttachmentBuilder(localPath, { name: localFilename })]
      });

      const msg = await interaction.fetchReply();
      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000 // 2 minutes
      });

      collector.on('collect', async btn => {
        if (btn.user.id !== interaction.user.id) {
          return btn.reply({ content: 'Only the command invoker can use these buttons.', ephemeral: true });
        }

        const safeDefer = async () => {
          if (!btn.replied && !btn.deferred) {
            try { await btn.deferUpdate(); } catch { /* noop */ }
          }
        };

        if (btn.customId === 'confirm') {
          collector.stop('confirmed');
          await safeDefer();

          await CD.create({
            title,
            activeEra,
            inactiveEra,
            active,
            available,
            localImagePath: localPath,
            createdBy: interaction.user.id
          });

          return interaction.editReply({
            content: `✅ CD **${title}** created successfully.`,
            embeds: [],
            components: []
          });
        }

        if (btn.customId === 'cancel') {
          collector.stop('cancelled');
          await safeDefer();
          return interaction.editReply({
            content: '❌ CD creation cancelled.',
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
      console.error('Error in /createcd:', err);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          content: 'There was an error executing the command.',
          ephemeral: true
        });
      }
    }
  }
};
