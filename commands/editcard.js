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
    .addUserOption(opt => opt.setName('designer').setDescription('Set new designer')),

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

  const updates = {};

  if (opts.getString('setcode')) updates.cardCode = opts.getString('setcode');
  if (opts.getString('setname')) updates.name = opts.getString('setname');
  if (opts.getString('setgroup')) updates.group = opts.getString('setgroup');
  if (opts.getString('setera')) updates.era = opts.getString('setera');

  if (opts.getString('setrarity')) {
    const setRarity = opts.getString('setrarity');
    const rarityValue = parseInt(setRarity);
    if (!isNaN(rarityValue)) updates.rarity = rarityValue;
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

  const matched = await Card.find(filters);

  if (matched.length === 0) {
    return interaction.editReply('❌ No cards matched your filters.');
  }

  const pages = matched.map((card, index) => {
    const rarityDisplay = generateStars(
      updates.rarity ?? card.rarity,
      overrideEmoji || '<:fullstar:1387609456824680528>',
      '<:blankstar:1387609460385779792>'
    );

    const embed = new EmbedBuilder()
      .setTitle(`Card Preview ${index + 1} of ${matched.length}`)
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

    if (card.discordPermalinkImage) {
      embed.setImage(card.discordPermalinkImage);
    }

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
      return btn.update({ content: `✅ Updated ${matched.length} card(s).`, embeds: [], components: [] });
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