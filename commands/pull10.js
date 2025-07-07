const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Canvas = require('canvas');
const { isOnCooldown, setCooldown, getCooldownTimestamp } = require('../utils/cooldownManager');
const cooldowns = require('../utils/cooldownConfig');
const handleReminders = require('../utils/reminderHandler');
const giveCurrency = require('../utils/giveCurrency');
const Card = require('../models/Card');
const UserInventory = require('../models/UserInventory');
const rarityEmoji = require('../utils/rarityEmoji'); // ➕ your rarity emoji helper
const pickRarity = require('../utils/rarityPicker');
const generateStars = require('../utils/starGenerator');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pull10')
    .setDescription('Pull 10 cards at once')
    .addBooleanOption(opt =>
      opt.setName('reminder')
        .setDescription('Remind when cooldown ends')
        .setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('remindinchannel')
        .setDescription('Remind in channel instead of DM')
        .setRequired(false)),

  async execute(interaction) {
    const userId = interaction.user.id;
    const commandName = 'pull10';
    const cooldownDuration = cooldowns[commandName];

    if (isOnCooldown(userId, commandName)) {
      return interaction.reply({
        content: `You must wait **${getCooldownTimestamp(userId, commandName)}** to pull again.`,
        
      });
    }

    // 🕒 Set cooldown & reminders
    setCooldown(userId, commandName, cooldownDuration);
    await handleReminders(interaction, commandName, cooldownDuration);

    await interaction.deferReply();

    // 🃏 Fetch 10 random pullable cards
    const cards = await Card.aggregate([
      { $match: { pullable: true } },
      { $sample: { size: 10 } }
    ]);

    if (cards.length < 10) {
      return interaction.editReply({ content: 'Not enough cards available to pull 10.' });
    }

    // 🖼️ Canvas 5x2 layout
    const cols = 5, rows = 2;
    const cardW = 160, cardH = 240;
    const padding = 10;
    const canvasW = cols * (cardW + padding) + padding;
    const canvasH = rows * (cardH + padding) + padding;
    const canvas = Canvas.createCanvas(canvasW, canvasH);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2f3136';
    ctx.fillRect(0, 0, canvasW, canvasH);

    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const img = await Canvas.loadImage(c.discordPermLinkImage || c.imgurImageLink);
      const x = padding + (i % cols) * (cardW + padding);
      const y = padding + Math.floor(i / cols) * (cardH + padding);
      ctx.drawImage(img, x, y, cardW, cardH);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(x, y, cardW, cardH);
    }

    const buffer = canvas.toBuffer();
    const attachment = { attachment: buffer, name: 'pull10.png' };

    // 📦 Inventory logic
    let inv = await UserInventory.findOne({ userId });
    if (!inv) inv = await UserInventory.create({ userId, cards: [] });

    const pullLines = [];
    for (const c of cards) {
      const emoji = generateStars({ rarity: c.rarity });
      const found = inv.cards.find(v => v.cardCode === c.cardCode);
      if (found) {
        found.quantity += 1;
        pullLines.push(`${emoji} **${c.name}** \`${c.cardCode}\` (Total: **${found.quantity}**)`);
      } else {
        inv.cards.push({ cardCode: c.cardCode, quantity: 1 });
        pullLines.push(`${emoji} **${c.name}** · \`${c.cardCode}\` · (Total: **1**)`);
      }
    }
    await inv.save();

    // 🧾 Final embed
    const embed = new EmbedBuilder()
      .setTitle('Special Pull Complete!')
      .setImage('attachment://pull10.png')
      .setColor('#2f3136')
      .setDescription(pullLines.join('\n'))
      .setFooter({ text: `Pulled 10 cards at ${new Date().toUTCString()}` });

    await interaction.editReply({
      embeds: [embed],
      files: [attachment]
    });

    const UserRecord = require('../models/UserRecord');

for (const card of cards) {
  await UserRecord.create({
    userId: userId,
    type: 'pull10',
    detail: `Pulled ${card.name} (${card.cardCode}) [${card.rarity}]`
  });
}
  }
};