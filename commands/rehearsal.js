const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const Canvas = require('canvas');
const cooldowns = require('../utils/cooldownManager');
const cooldownConfig = require('../utils/cooldownConfig');
const handleReminders = require('../utils/reminderHandler');
const Card = require('../models/Card');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rehearsal')
    .setDescription('Pick a rehearsal card and earn rare sopop!')
    .addBooleanOption(opt =>
      opt.setName('reminder').setDescription('Remind when cooldown ends').setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('remindinchannel').setDescription('Remind in channel instead of DM').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();
    const userId = interaction.user.id;
    const commandName = 'rehearsal';
    const cooldownDuration = cooldownConfig[commandName];

    if (await cooldowns.isOnCooldown(userId, commandName)) {
      const nextTime = await cooldowns.getCooldownTimestamp(userId, commandName);
      return interaction.editReply({
        content: `You must wait **${nextTime}** before rehearsing again.`
      });
    }

    await cooldowns.setCooldown(userId, commandName, cooldownDuration);
    await handleReminders(interaction, commandName, cooldownDuration);

    const cards = await Card.aggregate([
      { $match: { pullable: true } },
      { $sample: { size: 3 } }
    ]);

    if (cards.length < 3) {
      return interaction.editReply({ content: 'Not enough pullable cards in the database.' });
    }

    const canvas = Canvas.createCanvas(600, 340);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2f3136';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const img = await Canvas.loadImage(c.imgurImageLink || c.discordPermalinkImage);
      const cardX = i * 200 + 10;
      const cardY = 10;
      ctx.drawImage(img, cardX, cardY, 180, 240);
      let textY = cardY + 260;
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px Sans';
      ctx.fillText(`Rarity: ${c.rarity}`, cardX, textY); textY += 18;
      ctx.fillText(`Group: ${c.group}`, cardX, textY); textY += 18;
      ctx.fillText(`Code: ${c.cardCode}`, cardX, textY);
    }

    const buffer = canvas.toBuffer();
    const attachment = { attachment: buffer, name: 'rehearsal.png' };

    const embed = new EmbedBuilder()
      .setTitle('Choose Your Rehearsal Card')
      .setImage('attachment://rehearsal.png')
      .setColor('#2f3136');

    const row = new ActionRowBuilder().addComponents(
      cards.map((_, i) =>
        new ButtonBuilder()
          .setCustomId(`rehearsal_${i}`)
          .setLabel(`${i + 1}`)
          .setStyle(ButtonStyle.Primary)
      )
    );

    // ✅ Store cards temporarily for interactionRouter
    interaction.client.cache ??= {};
    interaction.client.cache.rehearsal ??= {};
    interaction.client.cache.rehearsal[userId] = cards;

    await interaction.editReply({
      embeds: [embed],
      files: [attachment],
      components: [row]
    });
  }
};