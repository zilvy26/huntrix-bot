// /commands/global/pull10.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Canvas = require('canvas');
const cooldowns = require('../../utils/cooldownManager');
const handleReminders = require('../../utils/reminderHandler');
const Card = require('../../models/Card');
const UserInventory = require('../../models/UserInventory');
const InventoryItem = require('../../models/InventoryItem');
const pickRarity = require('../../utils/rarityPicker');
const getRandomCardByRarity = require('../../utils/randomCardFromRarity');
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
    const rarities = await Promise.all(
  Array.from({ length: 10 }, () => pickRarity())
);

const pulls = (await Promise.all(
  rarities.map(async (rarity) => getRandomCardByRarity(rarity))
)).filter(Boolean);

if (pulls.length < 10) {
  return safeReply(interaction, { content: 'Not enough cards available to pull 10.' });
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

   // 6) Inventory (per-item model, bulk upsert with counts)

// count how many times each cardCode appeared in this pull10
const counts = new Map();
for (const card of pulls) {
  counts.set(card.cardCode, (counts.get(card.cardCode) || 0) + 1);
}

// build one update per unique cardCode
const bulkOps = [];
for (const [code, n] of counts.entries()) {
  bulkOps.push({
    updateOne: {
      filter: { userId, cardCode: code },
      update: {
        $setOnInsert: { userId, cardCode: code, quantity: 0 },
        $inc: { quantity: n }
      },
      upsert: true
    }
  });
}

// execute all increments at once
if (bulkOps.length) {
  await InventoryItem.bulkWrite(bulkOps, { ordered: false });
}

// fetch updated quantities (once) so we can show totals
const codes = Array.from(counts.keys());
const updatedDocs = await InventoryItem.find(
  { userId, cardCode: { $in: codes } },
  { cardCode: 1, quantity: 1, _id: 0 }
).lean();

const qtyMap = Object.fromEntries(updatedDocs.map(d => [d.cardCode, d.quantity]));

// build 10 display lines, in the same order as pulls
const lines = pulls.map(card => {
  const emoji = generateStars({ rarity: card.rarity, overrideEmoji: card.emoji });
  const total = qtyMap[card.cardCode];
  return `${emoji} **${card.name}** \`${card.cardCode}\` (Total: **${total}**)`;
});

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