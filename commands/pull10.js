const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Canvas = require('canvas');
const cooldowns = require('../utils/cooldownManager'); // ✅ use full object
const cooldownConfig = require('../utils/cooldownConfig');
const handleReminders = require('../utils/reminderHandler');
const giveCurrency = require('../utils/giveCurrency');
const Card = require('../models/Card');
const UserInventory = require('../models/UserInventory');
const rarityEmoji = require('../utils/rarityEmoji');
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
  const commandName = 'Pull10';
  const cooldownMs = await cooldowns.getEffectiveCooldown(interaction, commandName);

  if (await cooldowns.isOnCooldown(userId, commandName)) {
    const ts = await cooldowns.getCooldownTimestamp(userId, commandName);
    return interaction.reply({ content: `You must wait **${ts}** to pull again.` });
  }

  await cooldowns.setCooldown(userId, commandName, cooldownMs);
  await handleReminders(interaction, commandName, cooldownMs);
  await interaction.deferReply();

  // 🔄 Generate 10 pulls using pickRarity + Mongo
  const pulls = [];
  for (let i = 0; i < 10; i++) {
    const rarity = pickRarity();
    const card = await Card.aggregate([
      { $match: { pullable: true, rarity, localImagePath: { $exists: true } } },
      { $sample: { size: 1 } }
    ]);

    if (card[0]) pulls.push(card[0]);
  }

  if (pulls.length < 10) {
    return interaction.editReply({ content: '❌ Not enough cards available to pull 10.' });
  }

  // 🖼️ Canvas Layout
  const cols = 5, rows = 2, cardW = 160, cardH = 240, padding = 10;
  const canvasW = cols * (cardW + padding) + padding;
  const canvasH = rows * (cardH + padding) + padding;
  const canvas = Canvas.createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2f3136';
  ctx.fillRect(0, 0, canvasW, canvasH);

  for (let i = 0; i < pulls.length; i++) {
    try {
      const img = await Canvas.loadImage(pulls[i].localImagePath);
      const x = padding + (i % cols) * (cardW + padding);
      const y = padding + Math.floor(i / cols) * (cardH + padding);
      ctx.drawImage(img, x, y, cardW, cardH);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(x, y, cardW, cardH);
    } catch (err) {
      console.error(`Failed to load image for ${pulls[i].cardCode}:`, err.message);
    }
  }

  const buffer = canvas.toBuffer();
  const attachment = { attachment: buffer, name: 'pull10.png' };

  // 📦 Inventory Logic
  let inv = await UserInventory.findOne({ userId });
  if (!inv) inv = await UserInventory.create({ userId, cards: [] });

  const pullLines = [];

  for (const card of pulls) {
    const emoji = generateStars({ rarity: card.rarity, overrideEmoji: card.emoji });
    const found = inv.cards.find(v => v.cardCode === card.cardCode);
    if (found) {
      found.quantity += 1;
      pullLines.push(`${emoji} **${card.name}** \`${card.cardCode}\` (Total: **${found.quantity}**)`);
    } else {
      inv.cards.push({ cardCode: card.cardCode, quantity: 1 });
      pullLines.push(`${emoji} **${card.name}** · \`${card.cardCode}\` · (Total: **1**)`);
    }
  }

  inv.markModified('cards');
  await inv.save();

  const embed = new EmbedBuilder()
    .setTitle('Special Pull Complete')
    .setImage('attachment://pull10.png')
    .setColor('#2f3136')
    .setDescription(pullLines.join('\n'))
    .setFooter({ text: `Pulled at ${new Date().toUTCString()}` });

  await interaction.editReply({
    embeds: [embed],
    files: [attachment]
  });

  const UserRecord = require('../models/UserRecord');
  for (const card of pulls) {
    await UserRecord.create({
      userId,
      type: 'pull10',
      detail: `Pulled ${card.name} (${card.cardCode}) [${card.rarity}]`
    });
  }
}
};