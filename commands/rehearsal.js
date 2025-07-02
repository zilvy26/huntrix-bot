const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const Canvas = require('canvas');
const { isOnCooldown, setCooldown, getCooldownTimestamp } = require('../utils/cooldownManager');
const cooldowns = require('../utils/cooldownConfig');
const handleReminders = require('../utils/reminderHandler');
const giveCurrency = require('../utils/giveCurrency');
const Card = require('../models/Card');
const UserInventory = require('../models/UserInventory');
const UserRecord = require('../models/UserRecord');

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
    const cooldownDuration = cooldowns[commandName];

    if (isOnCooldown(userId, commandName)) {
      const nextTime = getCooldownTimestamp(userId, commandName);
      return interaction.editReply({
        content: `⏳ You must wait **${nextTime}** before rehearsing again.`,
        
      });
    }

    // 🔄 Get 3 random pullable cards
    const cards = await Card.aggregate([
      { $match: { pullable: true } },
      { $sample: { size: 3 } }
    ]);

    if (cards.length < 3) {
      return interaction.editReply({
        content: '❌ Not enough pullable cards in the database.',
        
      });
    }

    // 🖼️ Canvas setup
    const canvas = Canvas.createCanvas(600, 340);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2f3136';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const img = await Canvas.loadImage(c.discordPermLinkImage || c.imgurImageLink);
      const cardX = i * 200 + 10;
      const cardY = 10;
      ctx.drawImage(img, cardX, cardY, 180, 240);

      // Text under card
      const textX = cardX;
      let textY = cardY + 260;
      ctx.fillStyle = '#ffffff';
      ctx.font = '15px Sans';
      ctx.fillText(`Rarity: ${c.rarity}`, textX, textY); textY += 18;
      ctx.fillText(`Group: ${c.group}`, textX, textY); textY += 18;
      ctx.fillText(`Code: ${c.cardCode}`, textX, textY);
    }

    const buffer = canvas.toBuffer();
    const attachment = { attachment: buffer, name: 'rehearsal.png' };

    const embed = new EmbedBuilder()
      .setTitle('🎭 Choose Your Rehearsal Card')
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

    await interaction.editReply({
      embeds: [embed],
      files: [attachment],
      components: [row]
    });

    // 🎮 Button selection logic
    const collector = interaction.channel.createMessageComponentCollector({
      filter: btn => btn.user.id === userId && btn.customId.startsWith('rehearsal_'),
      time: 60000,
      max: 1
    });

    collector.on('collect', async btn => {
      await btn.deferUpdate();
      const idx = parseInt(btn.customId.split('_')[1]);
      const selected = cards[idx];

      // 🎁 Sopop reward only
      const sopop = Math.random() < 0.58 
        ? (Math.random() < 0.75 ? 1 : 2) // 75% for 1, 25% for 2
        : 0;
      const user = await giveCurrency(userId, { sopop });

      // 💾 Add to UserInventory
      let inv = await UserInventory.findOne({ userId });
      if (!inv) inv = await UserInventory.create({ userId, cards: [] });

      const existing = inv.cards.find(c => c.cardCode === selected.cardCode);
      let copies = 1;
      if (existing) {
        existing.quantity += 1;
        copies = existing.quantity;
      } else {
        inv.cards.push({ cardCode: selected.cardCode, quantity: 1 });
      }
      await inv.save();

      // ⏱ Cooldown + Reminder
      setCooldown(userId, commandName, cooldownDuration);
      await handleReminders(interaction, commandName, cooldownDuration);

      // ✅ Log the rehearsal pull
  await UserRecord.create({
    userId: userId,
    type: 'rehearsal',
    detail: `Chose ${selected.name} (${selected.cardCode}) [${selected.rarity}]`
  });

      // 🎯 Replace old canvas embed with final result
      const resultEmbed = new EmbedBuilder()
        .setTitle(`🎶 You chose: ${selected.name}`)
        .setDescription([
          `**Rarity:** ${selected.rarity}`,
          `**Name:** ${selected.name}`,
          ...(selected.category?.toLowerCase() === 'kpop' ? [`**Era:** ${selected.era}`] : []),
          `**Group:** ${selected.group}`,
          `**Code:** \`${selected.cardCode}\``,
          `**Copies Owned:** ${copies}`,
          `\n__Reward__:\n${sopop ? `• <:ehx_sopop:1389584273337618542> **${sopop}** Sopop` : '• <:ehx_sopop:1389584273337618542> 0 Sopop'}`
        ].join('\n'))
        .setImage(selected.discordPermLinkImage || selected.imgurImageLink)
        .setColor('#FFD700')

      await btn.editReply({
        embeds: [resultEmbed],
        files: [],
        components: []
      });
    });


    collector.on('end', async collected => {
      if (collected.size === 0) {
        try {
          await interaction.editReply({
            content: '⏰ You took too long. Try `/rehearsal` again later!',
            components: []
          });
        } catch (err) {
          console.warn('⏱️ Timeout edit failed:', err.message);
        }
      }
    });
  }
};