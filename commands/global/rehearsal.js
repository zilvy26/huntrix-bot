// commands/global/rehearsal.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const Canvas = require('canvas');
const cooldowns = require('../../utils/cooldownManager');
const cooldownConfig = require('../../utils/cooldownConfig');
const handleReminders = require('../../utils/reminderHandler');
const Card = require('../../models/Card');
const InventoryItem = require('../../models/InventoryItem'); // ✅ new
const pickRarity = require('../../utils/rarityPicker');
const { safeReply } = require('../../utils/safeReply');
const getRandomCardByRarity = require('../../utils/randomCardFromRarity');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rehearsal')
    .setDescription('Pick a rehearsal card and earn rare sopop!')
    .addBooleanOption(opt =>
      opt.setName('reminder').setDescription('Remind when cooldown ends'))
    .addBooleanOption(opt =>
      opt.setName('remindinchannel').setDescription('Remind in channel instead of DM')),

  async execute(interaction) {
    const userId = interaction.user.id;
    const commandName = 'Rehearsal';

    const cooldownDuration = await cooldowns.getEffectiveCooldown(interaction, commandName);
    if (await cooldowns.isOnCooldown(userId, commandName)) {
      const nextTime = await cooldowns.getCooldownTimestamp(userId, commandName);
      return safeReply(interaction, { content: `You must wait ${nextTime} before using \`/Rehearsal\` again.` });
    }

    await cooldowns.setCooldown(userId, commandName, cooldownDuration);
    await handleReminders(interaction, commandName, cooldownDuration);

    // Pick 3 random rarities and cards
    const rarities = await Promise.all(Array.from({ length: 3 }, () => pickRarity()));
    const pulls = (await Promise.all(rarities.map(r => getRandomCardByRarity(r)))).filter(Boolean);
    if (pulls.length < 3) {
      return safeReply(interaction, { content: 'Not enough pullable cards in the database.' });
    }

    // 🟢 Preload owned counts
    const codes = pulls.map(c => c.cardCode);
    const items = await InventoryItem.find({ userId, cardCode: { $in: codes } }, { cardCode: 1, quantity: 1 }).lean();
    const qtyMap = Object.fromEntries(items.map(i => [i.cardCode, i.quantity]));

    // Canvas
    const canvas = Canvas.createCanvas(600, 340);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2f3136';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < pulls.length; i++) {
      const c = pulls[i];
      const cardX = i * 200 + 10;
      const cardY = 10;

      if (c.localImagePath) {
        try {
          const img = await Canvas.loadImage(c.localImagePath);
          ctx.drawImage(img, cardX, cardY, 180, 240);
        } catch (err) {
          console.error(`❌ Failed to load image for ${c.cardCode}:`, err.message);
        }
      }

      let textY = cardY + 260;
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px Sans';
      ctx.fillText(`Rarity: ${c.rarity}`, cardX, textY); textY += 18;
      ctx.fillText(`Group: ${c.group}`, cardX, textY);  textY += 18;
      ctx.fillText(`Code: ${c.cardCode}`, cardX, textY); textY += 18;
      const copies = qtyMap[c.cardCode] ?? 0;
      ctx.fillText(`Copies: ${copies > 0 ? copies : 'Unowned'}`, cardX, textY);
    }

    const buffer = canvas.toBuffer();
    const attachment = { attachment: buffer, name: 'rehearsal.png' };

    const embed = new EmbedBuilder()
      .setTitle('Choose Your Rehearsal Card')
      .setImage('attachment://rehearsal.png')
      .setColor('#2f3136');

    const row = new ActionRowBuilder().addComponents(
      pulls.map((_, i) =>
        new ButtonBuilder()
          .setCustomId(`rehearsal_${i}`)
          .setLabel(`${i + 1}`)
          .setStyle(ButtonStyle.Primary)
      )
    );

    const sent = await interaction.fetchReply();

interaction.client.cache ??= {};
interaction.client.cache.rehearsalSessions ??= {};
interaction.client.cache.rehearsalSessions[sent.id] = {
  userId: interaction.user.id,
  pulls,          // the 3 cards
  claimed: false  // << guard against multiple clicks
};

    return safeReply(interaction, { embeds: [embed], files: [attachment], components: [row] });
  }
};
