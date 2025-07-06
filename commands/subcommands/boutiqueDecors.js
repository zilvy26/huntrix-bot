const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const User = require('../../models/User'); // Currency model
const UserRecord = require('../../models/UserRecord'); // Logs
const templateOptions = require('../../data/templateOptions'); // Shared template definitions

module.exports = async function(interaction) {
  const userId = interaction.user.id;
  const user = await User.findOne({ userId });

  if (!user) {
    return interaction.reply({ content: '❌ User not found.' });
  }

  const embed = new EmbedBuilder()
    .setTitle('🎨 Boutique Templates')
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

  await interaction.reply({
    embeds: [embed],
    components: [row],
    
  });

  const collector = interaction.channel.createMessageComponentCollector({
    componentType: 3, // StringSelect
    time: 30000,
    max: 1
  });

  collector.on('collect', async select => {
    if (select.user.id !== userId) {
      return select.reply({ content: "This menu isn't for you." });
    }

    const selectedId = select.values[0];
    const template = templateOptions.find(t => t.id === selectedId);

    if (!template) {
      return select.reply({ content: '❌ Invalid template selected.' });
    }

    if (user.templatesOwned?.includes(template.id)) {
      return select.reply({ content: `❌ You already own **${template.name}**.` });
    }

    if (user.sopop < template.price) {
      return select.reply({
        content: `❌ You need ${template.price.toLocaleString()} Sopop (you have ${user.sopop.toLocaleString()}).`,
        
      });
    }

    // Deduct and grant
    user.sopop -= template.price;
    user.templatesOwned = [...(user.templatesOwned || []), template.id];
    await user.save();

    await UserRecord.create({
      userId,
      type: 'templatepurchase',
      detail: `Bought ${template.name} for ${template.price}`
    });

    return select.reply({
      content: `✅ You bought **${template.name}** for ${template.price.toLocaleString()} Sopop!`,
      
    });
  });

  collector.on('end', collected => {
    if (collected.size === 0) {
      interaction.editReply({
        content: '⏱️ You didn’t select anything in time. Purchase cancelled.',
        embeds: [],
        components: []
      });
    }
  });
};