// /commands/global/pull10.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Canvas = require('canvas');
const cooldowns = require('../../utils/cooldownManager');
const handleReminders = require('../../utils/reminderHandler');
const Card = require('../../models/Card');
const UserInventory = require('../../models/UserInventory');
const pickRarity = require('../../utils/rarityPicker');
const generateStars = require('../../utils/starGenerator');
const { safeReply, safeDefer } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pull10')
    .setDescription('Pull 10 cards at once')
    .addBooleanOption(opt =>
      opt.setName('reminder').setDescription('Remind when cooldown ends').setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('remindinchannel').setDescription('Remind in channel instead of DM').setRequired(false)),

  async execute(interaction) {
    const userId = interaction.user.id;
    const commandName = 'Pull10';

    // 2) Cooldown check AFTER we own the interaction window
    const cooldownMs = await cooldowns.getEffectiveCooldown(interaction, commandName);
    if (await cooldowns.isOnCooldown(userId, commandName)) {
      const ts = await cooldowns.getCooldownTimestamp(userId, commandName);
      return safeReply(interaction, { content: `You must wait **${ts}** to pull again.` });
    }
    // 3) Only now set cooldown & reminders (so failed ACKs don’t burn CD)
    await cooldowns.setCooldown(userId, commandName, cooldownMs);
    await handleReminders(interaction, commandName, cooldownMs);

    // 4) Generate 10 pulls (parallel to reduce jitter)
    const rarities = Array.from({ length: 10 }, () => pickRarity());
    const pulls = (await Promise.all(
      rarities.map(rarity =>
        Card.aggregate([
          { $match: { pullable: true, rarity, localImagePath: { $exists: true } } },
          { $sample: { size: 1 } }
        ]).then(arr => arr[0]).catch(() => null)
      )
    )).filter(Boolean);

    if (pulls.length < 10) {
      return safeReply(interaction, { content: '❌ Not enough cards available to pull 10.' });
    }

    // 5) Canvas collage
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
        console.error(`Failed to load image for ${pulls[i]?.cardCode}:`, err?.message || err);
      }
    }

    const buffer = canvas.toBuffer();
    const attachment = { attachment: buffer, name: 'pull10.png' };

    // 6) Inventory
    let inv = await UserInventory.findOne({ userId });
    if (!inv) inv = await UserInventory.create({ userId, cards: [] });

    const lines = [];
    for (const card of pulls) {
      const emoji = generateStars({ rarity: card.rarity, overrideEmoji: card.emoji });
      const found = inv.cards.find(v => v.cardCode === card.cardCode);
      if (found) {
        found.quantity += 1;
        lines.push(`${emoji} **${card.name}** \`${card.cardCode}\` (Total: **${found.quantity}**)`);
      } else {
        inv.cards.push({ cardCode: card.cardCode, quantity: 1 });
        lines.push(`${emoji} **${card.name}** · \`${card.cardCode}\` · (Total: **1**)`);
      }
    }
    inv.markModified('cards');
    await inv.save();

    const embed = new EmbedBuilder()
      .setTitle('Special Pull Complete')
      .setImage('attachment://pull10.png')
      .setColor('#2f3136')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Pulled at ${new Date().toUTCString()}` });

    await safeReply(interaction, { embeds: [embed], files: [attachment] });

    // 7) Audit (don’t block the reply if any single write fails)
    try {
      const UserRecord = require('../../models/UserRecord');
      await Promise.all(pulls.map(card =>
        UserRecord.create({
          userId,
          type: 'pull10',
          detail: `Pulled ${card.name} (${card.cardCode}) [${card.rarity}]`
        })
      ));
    } catch (e) {
      console.warn('UserRecord logging failed:', e?.message || e);
    }
  }
};