const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const UserInventory = require('../../models/UserInventory');
const User = require('../../models/User');
const Card = require('../../models/Card');
const generateStars = require('../../utils/starGenerator');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('spawn')
    .setDescription('Drop a card or currency for the fastest person to claim')
    .setDefaultMemberPermissions('0')
    .addStringOption(opt =>
      opt.setName('reward')
        .setDescription('CardCode or currency name (patterns / sopop)')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('amount')
        .setDescription('Amount of patterns/sopop (ignored for cards)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    // ✅ Optional: Admin check
    const ALLOWED_ROLE_ID = '1386797486680703036'; // replace with your actual role ID

    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
    return interaction.editReply({ content: 'Only authorized staff can use this command.' });
}

    const reward = interaction.options.getString('reward').toLowerCase();
    const amount = interaction.options.getInteger('amount') ?? 1;

    let isCurrency = reward === 'patterns' || reward === 'sopop';

    if (isCurrency) {
      const embed = new EmbedBuilder()
        .setTitle('Currency Drop!')
        .setDescription(`First to click gets **${amount} ${reward}**!`)
        .setColor('#ffd700');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('claim_reward').setLabel('Claim!').setStyle(ButtonStyle.Success)
      );

      const dropMsg = await interaction.editReply({ embeds: [embed], components: [row] });

      const collector = dropMsg.createMessageComponentCollector({ filter: i => !i.user.bot, max: 1, time: 15000 });

      collector.on('collect', async i => {
        await User.findOneAndUpdate(
          { userId: i.user.id },
          { $inc: { [reward]: amount } },
          { upsert: true, new: true }
        );

        const claimed = new EmbedBuilder()
          .setTitle('Claimed!')
          .setDescription(`${i.user} claimed **${amount} ${reward}**!`)
          .setColor('#00cc99');

        await i.update({ embeds: [claimed], components: [] });
      });

      collector.on('end', (_, reason) => {
        if (reason === 'time') {
          interaction.editReply({ content: 'No one claimed in time.', components: [] });
        }
      });

      return;
    }
    // Handle card drop
    const card = await Card.findOne({ cardCode: { $regex: new RegExp(`^${reward}$`, 'i') } });
    if (!card) {
      return interaction.editReply({ content: 'Invalid cardCode or currency name.' });
    }

    const stars = generateStars({ rarity: card.rarity, overrideEmoji: card.emoji || '<:fullstar:1387609456824680528>' });

    const imageSrc = card.localImagePath ? `attachment://${card._id}.png` :
      card.discordPermalinkImage || card.imgurImageLink;

    const files = card.localImagePath ? [{ attachment: card.localImagePath, name: `${card._id}.png` }] : [];

    const cardEmbed = new EmbedBuilder()
      .setTitle(stars)
      .setDescription([
        `**Group:** ${card.group}`,
        `**Name:** ${card.name}`,
        ...(card.category?.toLowerCase() === 'kpop' ? [`**Era:** ${card.era}`] : []),
        `**Code:** \`${card.cardCode}\``
      ].join('\n'))
      .setImage(imageSrc)
      .setColor('#ff4444');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('claim_card').setLabel('Claim!').setStyle(ButtonStyle.Success)
    );

    const dropMsg = await interaction.editReply({ embeds: [cardEmbed], components: [row], files });

    const collector = dropMsg.createMessageComponentCollector({ filter: i => !i.user.bot, max: 1, time: 15000 });

    collector.on('collect', async i => {
      const userId = i.user.id;
      let inv = await UserInventory.findOne({ userId });
      if (!inv) inv = new UserInventory({ userId, cards: [] });

      const entry = inv.cards.find(c => c.cardCode === card.cardCode);
      if (entry) entry.quantity += 1;
      else inv.cards.push({ cardCode: card.cardCode, quantity: 1 });

      await inv.save();

      const confirmed = new EmbedBuilder()
        .setTitle('Claimed!')
        .setDescription(`${i.user} claimed **${card.name}** \`[${card.cardCode}]\`!`)
        .setColor('#00cc99')
        .setImage(imageSrc);

      await i.update({ embeds: [confirmed], components: [], files });
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') {
        interaction.editReply({ content: 'No one claimed in time.', components: [] });
      }
    });
  }
};