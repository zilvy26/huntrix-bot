// commands/global/rehearsal.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder
} = require('discord.js');
const Canvas = require('canvas');
const cooldowns = require('../../utils/cooldownManager');
const cooldownConfig = require('../../utils/cooldownConfig');
const handleReminders = require('../../utils/reminderHandler');
const InventoryItem = require('../../models/InventoryItem');
const Card = require('../../models/Card');
const pickRarity = require('../../utils/rarityPicker');
const {safeReply} = require('../../utils/safeReply'); // compat export
const getRandomCardByRarity = require('../../utils/randomCardFromRarity');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rehearsal')
    .setDescription('Pick a rehearsal card and earn rare sopop!')
    .addBooleanOption(opt =>
      opt.setName('reminder').setDescription('Remind when cooldown ends').setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('remindinchannel').setDescription('Remind in channel instead of DM').setRequired(false)),

  async execute(interaction) {
    // Handler has already deferReply()'d for us — don't defer here
    const userId = interaction.user.id;
    const commandName = 'Rehearsal';

    // Cooldown check (no set yet)
    const cooldownDuration = await cooldowns.getEffectiveCooldown(interaction, commandName);
        if (await cooldowns.isOnCooldown(userId, commandName)) {
          const nextTime = await cooldowns.getCooldownTimestamp(userId, commandName);
          return safeReply(interaction, { content: `You must wait ${nextTime} before using \`/Rehearsal\` again.` });
        }

    // Start cooldown & schedule reminder AFTER the handler’s ACK
    await cooldowns.setCooldown(userId, commandName, cooldownDuration);
    await handleReminders(interaction, commandName, cooldownDuration);
    
    // pick 3 cards
    const rarities = await Promise.all(Array.from({ length: 3 }, () => pickRarity()));
    const pulls = (await Promise.all(rarities.map(r => getRandomCardByRarity(r)))).filter(Boolean);
    if (pulls.length < 3) return safeReply(interaction, { content: 'Not enough cards to show.' });

    // preload quantities
    const codes = pulls.map(c => c.cardCode);
    const items = await InventoryItem.find(
      { userId, cardCode: { $in: codes } },
      { _id: 0, cardCode: 1, quantity: 1 }
    ).lean();
    const qty = Object.fromEntries(items.map(i => [i.cardCode, i.quantity]));

    // canvas
    const canvas = Canvas.createCanvas(600, 340);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#2f3136';
ctx.fillRect(0, 0, canvas.width, canvas.height);

for (let i = 0; i < pulls.length; i++) {
  const c = pulls[i];
  const cardX = i * 200 + 10;  // (180 width + 20 gutter)
  const cardY = 10;

  // Try to draw the image, but never bail out of the loop if it fails
  if (c.localImagePath) {
    try {
      const img = await Canvas.loadImage(c.localImagePath);
      ctx.drawImage(img, cardX, cardY, 180, 240);
    } catch (err) {
      console.warn('⚠️ rehearsal img fail', c.cardCode, err.message);
    }
  } else {
    console.warn('⚠️ No local image for card', c.cardCode);
  }

  // Text block (always drawn)
  ctx.fillStyle = '#ffffff';
  ctx.font = '10px Sans';
  let textY = cardY + 260; // 240 image + 20px margin

  ctx.fillText(`Rarity: ${c.rarity}`,   cardX, textY); textY += 18;
  ctx.fillText(`Group: ${c.group}`,     cardX, textY); textY += 18;
  ctx.fillText(`Code: ${c.cardCode}`,   cardX, textY); textY += 18;

  const n = (qty?.[c.cardCode] ?? 0);
  ctx.fillText(`Copies: ${n > 0 ? n : 'Unowned'}`, cardX, textY);
}

    const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'rehearsal.png' });
    const embed = new EmbedBuilder()
      .setTitle('Choose Your Rehearsal Card')
      .setImage('attachment://rehearsal.png')
      .setColor('#2f3136');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rehearsal_0').setLabel('1').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('rehearsal_1').setLabel('2').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('rehearsal_2').setLabel('3').setStyle(ButtonStyle.Primary)
    );

    await safeReply(interaction, { embeds: [embed], files: [attachment], components: [row] });

    // IMPORTANT: store session by messageId so the button handler can find it
    const sent = await interaction.fetchReply();
    interaction.client.cache ??= {};
    interaction.client.cache.rehearsalSessions ??= {};
    interaction.client.cache.rehearsalSessions[sent.id] = {
      userId,
      pulls,
      claimed: false
    };
  }
};