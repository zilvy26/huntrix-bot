const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const User = require('../../../models/User');
const templateOptions = require('../../../data/templateOptions');
const safeReply = require('../../../utils/safeReply');

module.exports = async function(interaction) {
  const userId = interaction.user.id;
  const user = await User.findOne({ userId });

  if (!user) {
    return safeReply(interaction, { content: 'User not found.' });
  }

  const embed = new EmbedBuilder()
    .setTitle('Boutique Templates')
    .setDescription('Select a template to purchase from the dropdown below.')
    .setFooter({ text: `Your balance: ${user.sopop.toLocaleString()} Sopop` })
    .setColor('#f39c12');

  const menu = new StringSelectMenuBuilder()
    .setCustomId('select_template')
    .setPlaceholder('Choose a template to purchase')
    .addOptions(
      templateOptions.map(t => ({
        label: t.name,
        value: t.id,
        description: `${t.price.toLocaleString()} Sopop` +
          (user.templatesOwned?.includes(t.id) ? ' (Owned)' : ''),
        default: false
      }))
    );

  const row = new ActionRowBuilder().addComponents(menu);

  await safeReply(interaction, {
    embeds: [embed],
    components: [row],
    
  });
};