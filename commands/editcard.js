const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');

const Card = require('../models/Card');
const generateStars = require('../utils/starGenerator');
const awaitUserButton = require('../utils/awaitUserButton');
const parseRarity = require('../utils/parseRarity');
const uploadCardImage = require('../utils/imageUploader');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editcards')
    .setDescription('Edit multiple Huntrix cards with preview and confirmation')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    // Filters
    .addStringOption(opt => opt.setName('code').setDescription('Filter by card code'))
    .addStringOption(opt => opt.setName('name').setDescription('Filter by card name'))
    .addStringOption(opt => opt.setName('group').setDescription('Filter by card group'))
    .addStringOption(opt => opt.setName('era').setDescription('Filter by card era'))
    .addStringOption(opt => opt.setName('rarity').setDescription('Filter by current rarity'))

    // Editable Fields
    .addStringOption(opt => opt.setName('setcode').setDescription('Set new card code'))
    .addStringOption(opt => opt.setName('setname').setDescription('Set new name'))
    .addStringOption(opt => opt.setName('setgroup').setDescription('Set new group'))
    .addStringOption(opt => opt.setName('setera').setDescription('Set new era'))
    .addStringOption(opt => opt.setName('setrarity').setDescription('Set new rarity (e.g. 1S to 5S)'))
    .addStringOption(opt => opt.setName('setemoji').setDescription('Override emoji used for rarity'))
    .addBooleanOption(opt => opt.setName('setpullable').setDescription('Set pullable?'))
    .addUserOption(opt => opt.setName('designer').setDescription('Set new designer'))
    .addAttachmentOption(opt =>
  opt.setName('setimage')
    .setDescription('Upload a new card image')
    .setRequired(false)
),

    async execute(interaction) {
  await interaction.deferReply();

  const opts = interaction.options;

  const filters = {};

  if (opts.getString('code')) filters.cardCode = opts.getString('code');
  if (opts.getString('name')) filters.name = opts.getString('name');
  if (opts.getString('group')) filters.group = opts.getString('group');
  if (opts.getString('era')) filters.era = opts.getString('era');
  if (opts.getString('rarity')) {
    const rarityInput = opts.getString('rarity');
    const rarityValue = parseInt(rarityInput);
    if (!isNaN(rarityValue)) filters.rarity = rarityValue;
  }

  const matchedCards = await Card.find(filters);
if (!matchedCards.length) {
  return interaction.editReply({ content: '❌ No cards matched your filters.' });
}

  const updates = {};

  if (opts.getString('setcode')) updates.cardCode = opts.getString('setcode');
  if (opts.getString('setname')) updates.name = opts.getString('setname');
  if (opts.getString('setgroup')) updates.group = opts.getString('setgroup');
  const imageAttachment = opts.getAttachment('setimage');
if (imageAttachment) {
  const uploadResult = await uploadCardImage(
    interaction.client,
    imageAttachment.url,
    matchedCards[0].name,        // ← use actual card name
    matchedCards[0].cardCode     // ← use actual card code
  );

  updates.discordPermalinkImage = uploadResult.discordUrl;
  updates.imgurImageLink = uploadResult.imgurUrl;
}
  if (opts.getString('setera')) updates.era = opts.getString('setera');

  if (opts.getString('setrarity')) {
  const setRarity = opts.getString('setrarity');
  const rarityValue = parseRarity(setRarity);
  if (!isNaN(rarityValue)) updates.rarity = rarityValue;

  if (updates.rarity < 1 || updates.rarity > 5) {
    return interaction.editReply({
      content: '❌ Rarity must be between 1 and 5.',
      ephemeral: true
    });
  }
}

  if (opts.getBoolean('setpullable') !== null) {
    updates.pullable = opts.getBoolean('setpullable');
  }

  if (opts.getUser('designer')) {
    updates.designerId = opts.getUser('designer').id;
  }

  const overrideEmoji = opts.getString('setemoji') || null;

  if (Object.keys(filters).length === 0) {
    return interaction.editReply('⚠️ You must provide at least one filter (name, code, etc).');
  }

  if (Object.keys(updates).length === 0) {
    return interaction.editReply('⚠️ You must provide at least one field to update.');
  }


  const pages = matchedCards.map((card, index) => {
    const rarityDisplay = generateStars({
  rarity: updates.rarity ?? card.rarity,
  overrideEmoji: updates.emoji || card.emoji
});

    const embed = new EmbedBuilder()
      .setTitle(`Card Preview ${index + 1} of ${matchedCards.length}`)
      .setDescription(`🆔 **${card.cardCode}** → \`${updates.cardCode || card.cardCode}\`\n` +
                      `🖋️ **${card.name}** → \`${updates.name || card.name}\``)
      .addFields(
        { name: 'Group', value: updates.group || card.group || '—', inline: true },
        { name: 'Era', value: updates.era || card.era || '—', inline: true },
        { name: 'Rarity', value: rarityDisplay, inline: true },
        { name: 'Pullable', value: String(
            updates.pullable !== undefined ? updates.pullable : card.pullable
          ), inline: true },
        { name: 'Designer', value: `<@${updates.designerId || card.designerId || 'None'}>`, inline: true }
      )
      .setColor('Blurple');

    const image = updates.discordPermalinkImage || card.discordPermalinkImage;
if (image) embed.setImage(image);

    return embed;
  });

  const backBtn = new ButtonBuilder()
    .setCustomId('back')
    .setLabel('⬅️ Back')
    .setStyle(ButtonStyle.Secondary);

  const nextBtn = new ButtonBuilder()
    .setCustomId('next')
    .setLabel('➡️ Next')
    .setStyle(ButtonStyle.Secondary);

  const confirmBtn = new ButtonBuilder()
    .setCustomId('confirm')
    .setLabel('✅ Confirm')
    .setStyle(ButtonStyle.Success);

  const cancelBtn = new ButtonBuilder()
    .setCustomId('cancel')
    .setLabel('❌ Cancel')
    .setStyle(ButtonStyle.Danger);

    let index = 0;

  await interaction.editReply({
    embeds: [pages[index]],
    components: [
      new ActionRowBuilder().addComponents(backBtn, nextBtn, confirmBtn, cancelBtn)
    ]
  });

  const msg = await interaction.fetchReply();

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60000
  });

  collector.on('collect', async btn => {
    if (btn.user.id !== interaction.user.id) {
      return btn.reply({ content: '❌ These buttons aren’t for you!', ephemeral: true });
    }

    if (btn.customId === 'next') {
      index = (index + 1) % pages.length;
      return btn.update({ embeds: [pages[index]] });
    }

    if (btn.customId === 'back') {
      index = (index - 1 + pages.length) % pages.length;
      return btn.update({ embeds: [pages[index]] });
    }

    if (btn.customId === 'cancel') {
      collector.stop('cancelled');
      return btn.update({ content: '❌ Update cancelled.', embeds: [], components: [] });
    }

    if (btn.customId === 'confirm') {
      collector.stop('confirmed');
      await Card.updateMany(filters, { $set: updates });
      return btn.update({ content: `✅ Updated ${matchedCards.length} card(s).`, embeds: [], components: [] });
    }
  });

  collector.on('end', (_, reason) => {
    if (!['confirmed', 'cancelled'].includes(reason)) {
      interaction.editReply({
        content: '⌛ Command timed out with no action.',
        embeds: [],
        components: []
      });
    }
  });
}
};