// commands/global/editcards.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  AttachmentBuilder
} = require('discord.js');

const Card = require('../../models/Card');
const safeReply = require('../../utils/safeReply');
const generateStars = require('../../utils/starGenerator');
const parseRarity = require('../../utils/parseRarity');
const uploadCardImage = require('../../utils/imageUploader');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editcards')
    .setDescription('Edit multiple Huntrix cards with preview and confirmation')
    .setDefaultMemberPermissions('0')
    .addStringOption(opt => opt.setName('code').setDescription('Filter by card code'))
    .addStringOption(opt => opt.setName('name').setDescription('Filter by card name'))
    .addStringOption(opt => opt.setName('group').setDescription('Filter by card group'))
    .addStringOption(opt => opt.setName('era').setDescription('Filter by card era'))
    .addStringOption(opt => opt.setName('rarity').setDescription('Filter by current rarity'))
    .addStringOption(opt => opt.setName('setcode').setDescription('Set new card code'))
    .addStringOption(opt => opt.setName('setname').setDescription('Set new name'))
    .addStringOption(opt => opt.setName('setgroup').setDescription('Set new group'))
    .addStringOption(opt => opt.setName('setera').setDescription('Set new era'))
    .addStringOption(opt => opt.setName('setrarity').setDescription('Set new rarity (1–5)'))
    .addStringOption(opt => opt.setName('setemoji').setDescription('Override emoji used for rarity'))
    .addBooleanOption(opt => opt.setName('setpullable').setDescription('Set pullable?'))
    .addUserOption(opt => opt.setName('designer').setDescription('Set new designer'))
    .addUserOption(opt => opt.setName('designer2').setDescription('Set optional second designer'))
    .addUserOption(opt => opt.setName('designer3').setDescription('Set optional third designer'))
    .addAttachmentOption(opt => opt.setName('setimage').setDescription('Upload a new card image')),

  async execute(interaction) {
    const allowedRole = process.env.CARD_CREATOR_ROLE_ID;
    if (!interaction.member.roles.cache.has(allowedRole)) {
      return safeReply(interaction, { content: '❌ You do not have permission to use this command.' });
    }

    const opts = interaction.options;
    const filters = {};
    if (opts.getString('code')) filters.cardCode = opts.getString('code');
    if (opts.getString('name')) filters.name = opts.getString('name');
    if (opts.getString('group')) filters.group = opts.getString('group');
    if (opts.getString('era')) filters.era = opts.getString('era');
    if (opts.getString('rarity')) {
      const rarityValue = parseInt(opts.getString('rarity'));
      if (!isNaN(rarityValue)) filters.rarity = rarityValue;
    }
    const matchedCards = await Card.find(filters);
    if (!matchedCards.length) {
      return safeReply(interaction, { content: '❌ No cards matched your filters.' });
    }

    const updates = {};
    if (opts.getString('setcode')) updates.cardCode = opts.getString('setcode');
    if (opts.getString('setname')) updates.name = opts.getString('setname');
    if (opts.getString('setgroup')) updates.group = opts.getString('setgroup');
    if (opts.getString('setera')) updates.era = opts.getString('setera');

    if (opts.getString('setrarity')) {
      const rarityValue = parseRarity(opts.getString('setrarity'));
      if (!isNaN(rarityValue) && rarityValue >= 1 && rarityValue <= 5) {
        updates.rarity = rarityValue;
      } else {
        return safeReply(interaction, { content: '❌ Rarity must be between 1 and 5.' });
      }
    }

    if (opts.getBoolean('setpullable') !== null) updates.pullable = opts.getBoolean('setpullable');

    const designerIds = [opts.getUser('designer'), opts.getUser('designer2'), opts.getUser('designer3')]
      .filter(Boolean).map(u => u.id);
    if (designerIds.length) updates.designerIds = designerIds;

    if (opts.getString('setemoji')) updates.emoji = opts.getString('setemoji');

    const imageAttachment = opts.getAttachment('setimage');
    if (imageAttachment) {
      const uploadResult = await uploadCardImage(imageAttachment, matchedCards[0].cardCode);
      if (!uploadResult.localPath) {
        return safeReply(interaction, { content: '❌ Failed to process and save image.' });
      }
      updates.localImagePath = uploadResult.localPath;
    }

    if (Object.keys(filters).length === 0) {
      return safeReply(interaction, { content: '⚠️ You must provide at least one filter (name, code, etc).' });
    }
    if (Object.keys(updates).length === 0) {
      return safeReply(interaction, { content: '⚠️ You must provide at least one field to update.' });
    }
    // Build preview pages
    const pages = matchedCards.map((card, idx) => {
      const rarityDisplay = generateStars({
        rarity: updates.rarity ?? card.rarity,
        overrideEmoji: updates.emoji || card.emoji
      });

      const embed = new EmbedBuilder()
        .setTitle(`Card Preview ${idx + 1} of ${matchedCards.length}`)
        .setDescription(`**${card.cardCode}** → \`${updates.cardCode || card.cardCode}\`\n` +
                        `**${card.name}** → \`${updates.name || card.name}\``)
        .addFields(
          { name: 'Group', value: updates.group || card.group || '—', inline: true },
          { name: 'Era', value: updates.era || card.era || '—', inline: true },
          { name: 'Rarity', value: rarityDisplay, inline: true },
          { name: 'Pullable', value: String(updates.pullable ?? card.pullable), inline: true },
          {
            name: 'Designer(s)',
            value: (updates.designerIds || card.designerIds || []).map(id => `<@${id}>`).join(', ') || 'None',
            inline: true
          }
        )
        .setColor('Blurple');

      const previewPath = updates.localImagePath || card.localImagePath;
      if (previewPath) embed.setImage(`attachment://${card._id}.png`);

      return {
        embed,
        attachment: previewPath ? new AttachmentBuilder(previewPath, { name: `${card._id}.png` }) : null
      };
    });

    const navRow = () => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('back').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('next').setLabel('➡️ Next').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('confirm').setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cancel').setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
    );

    let index = 0;
    const { embed, attachment } = pages[index];
    await safeReply(interaction, {
      embeds: [embed],
      components: [navRow()],
      files: attachment ? [attachment] : []
    });

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

    collector.on('collect', async btn => {
      if (btn.user.id !== interaction.user.id) {
        return btn.reply({ content: 'Only the command invoker can use these buttons.', ephemeral: true });
      }
      if (!btn.replied && !btn.deferred) {
        try { await btn.deferUpdate(); } catch {}
      }

      if (btn.customId === 'next' || btn.customId === 'back') {
        index = btn.customId === 'next'
          ? (index + 1) % pages.length
          : (index - 1 + pages.length) % pages.length;

        const { embed, attachment } = pages[index];
        return interaction.editReply({
          embeds: [embed],
          components: [navRow()],
          files: attachment ? [attachment] : []
        });
      }

      if (btn.customId === 'confirm') {
        collector.stop('confirmed');
        await Card.updateMany(filters, { $set: updates });

        if (updates.cardCode) {
          const UserInventory = require('../../models/UserInventory');
          for (const card of matchedCards) {
            await UserInventory.updateMany(
              { 'cards.cardCode': card.cardCode },
              { $set: { 'cards.$[elem].cardCode': updates.cardCode } },
              { arrayFilters: [{ 'elem.cardCode': card.cardCode }] }
            );
          }
        }

        return interaction.editReply({ content: `✅ Updated ${matchedCards.length} card(s).`, embeds: [], components: [] });
      }

      if (btn.customId === 'cancel') {
        collector.stop('cancelled');
        return interaction.editReply({ content: '❌ Edit operation cancelled.', embeds: [], components: [] });
      }
    });

    collector.on('end', async (_, reason) => {
      if (!['confirmed', 'cancelled'].includes(reason)) {
        try {
          const reply = await interaction.fetchReply();
          if (!reply.ephemeral && !reply.deleted) {
            await safeReply(interaction, { content: '⏰ Command timed out with no action.', embeds: [], components: [] });
          }
        } catch {}
      }
    });
  }
};