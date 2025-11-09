// commands/global/list.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle, 
  AttachmentBuilder
} = require('discord.js');
const Canvas = require('canvas');
const Card = require('../../models/Card'); // if not already required

const {safeReply} = require('../../utils/safeReply');
const pickRarity = require('../../utils/rarityPicker');                    // same as /pull
const getRandomCardByRarity = require('../../utils/randomCardFromRarity'); // same as /pull
const ListSet = require('../../models/ListSet');

// your cooldown utils (same as /pull & /pull10)
const cooldowns = require('../../utils/cooldownManager');
const cooldownConfig = require('../../utils/cooldownConfig'); // if you have per‑command config

// ⬇️ this is the same helper you used earlier for reminders on pulls
const handlerReminders = require('../../utils/reminderHandler'); // <- make sure this path matches your project

const DEFAULT_MINUTES = 15;
const COMMAND_NAME = 'List';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('Create 5 mystery claim buttons for random cards')
    .addBooleanOption(o =>
      o.setName('reminder')
       .setDescription('Remind you when /list cooldown is over')
    )
    .addBooleanOption(o =>
      o.setName('remindinchannel')
       .setDescription('Send the reminder in this channel instead of DM')
    )
    .setDMPermission(true),

  async execute(interaction) {
    const userId = interaction.user.id;

    // 0) Cooldown check
    const cooldownMs = typeof cooldownConfig?.[COMMAND_NAME] === 'number'
      ? cooldownConfig[COMMAND_NAME]
      : 60_000 * 2; // fallback: 2 minutes

    if (await cooldowns.isOnCooldown(userId, COMMAND_NAME)) {
      const ts = await cooldowns.getCooldownTimestamp(userId, COMMAND_NAME);
      return safeReply(interaction, { content: `You must wait **${ts}** before using /list again.` });
    }

    // Fixed duration for the buttons (no user control)
    const minutes = DEFAULT_MINUTES;
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

    // 1) Build 5 hidden slots (same rarity as /pull)
    const slots = [];
    for (let idx = 1; idx <= 5; idx++) {
      const rarity = await pickRarity();
      const card = await getRandomCardByRarity(rarity, userId);
      if (!card) return safeReply(interaction, { content: 'No pullable cards found right now.' });
      slots.push({ idx, cardId: card._id });
    }

    // === Create blurred composite image for the exact slot cards ===
// slots is an array like [{ idx, cardId }, ...] (preserve order)

// 1) Fetch the card docs in order matching slots
const cardIds = slots.map(s => s.cardId);
const cards = await Card.find({ _id: { $in: cardIds } }).lean();

// Create a lookup so we can preserve slots order
const cardById = Object.fromEntries(cards.map(c => [String(c._id), c]));

// Build ordered array of card docs corresponding to slots[]
const orderedCards = slots.map(s => cardById[String(s.cardId)] || null);

// 2) Canvas geometry (match your pull10 proportions or adjust)
const cols = 5, rows = 1;
const cardW = 160, cardH = 240, padding = 10;
const canvasW = cols * (cardW + padding) + padding;
const canvasH = rows * (cardH + padding) + padding;

const canvas = Canvas.createCanvas(canvasW, canvasH);
const ctx = canvas.getContext('2d');

// background to match embed
ctx.fillStyle = '#2f3136';
ctx.fillRect(0, 0, canvasW, canvasH);

// 3) Draw each card blurred (use localImagePath if present, otherwise a URL)
// If any card is missing, draw a placeholder box.
for (let i = 0; i < slots.length; i++) {
  const slot = slots[i];
  const cdoc = orderedCards[i];

  const x = padding + (i % cols) * (cardW + padding);
  const y = padding + Math.floor(i / cols) * (cardH + padding);

  try {
    let src;
    if (cdoc && cdoc.localImagePath) {
      // local path on disk (preferred)
      src = cdoc.localImagePath;
    } else if (cdoc && (cdoc.discordPermalinkImage || cdoc.imgurImageLink)) {
      // remote url fallback
      src = cdoc.discordPermalinkImage || cdoc.imgurImageLink;
    } else {
      src = null;
    }

    if (src) {
      const img = await Canvas.loadImage(src);
      // apply blur + slight darken so the image can't be read
      ctx.filter = 'blur(50px) brightness(1.5)'; // tune blur value
      ctx.drawImage(img, x, y, cardW, cardH);
      ctx.filter = 'none';
      // overlay and stroke for style
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, y, cardW, cardH);
      ctx.strokeStyle = '#ffffff33';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, cardW - 2, cardH - 2);
    } else {
      // missing image: draw simple placeholder
      ctx.fillStyle = '#1f2124';
      ctx.fillRect(x, y, cardW, cardH);
      ctx.fillStyle = '#ffffff66';
      ctx.font = '16px Sans';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Image missing', x + cardW / 2, y + cardH / 2);
      ctx.strokeStyle = '#ffffff33';
      ctx.strokeRect(x + 1, y + 1, cardW - 2, cardH - 2);
    }
  } catch (err) {
    console.warn(`list: failed to load/draw image for slot ${slot.idx}`, err?.message || err);
    // Draw fallback box so layout stays consistent
    ctx.fillStyle = '#1f2124';
    ctx.fillRect(x, y, cardW, cardH);
    ctx.fillStyle = '#ffffff66';
    ctx.font = '16px Sans';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Image error', x + cardW / 2, y + cardH / 2);
    ctx.strokeStyle = '#ffffff33';
    ctx.strokeRect(x + 1, y + 1, cardW - 2, cardH - 2);
  }
}

// 4) Export buffer & create AttachmentBuilder
const buffer = canvas.toBuffer();
const blurredAttachment = new AttachmentBuilder(buffer, { name: 'list-blurred.png' });

// Now when you send the embed below, attach `blurredAttachment` and set embed image to 'attachment://list-blurred.png'


    // 2) Start cooldown
    await cooldowns.setCooldown(userId, COMMAND_NAME, cooldownMs);
    // 2b) Schedule cooldown reminder like /pull & /pull10
    const wantReminder = interaction.options.getBoolean('reminder') ?? false;
    const remindInChannel = interaction.options.getBoolean('remindinchannel') ?? false;
    if (wantReminder && typeof handlerReminders === 'function') {
      // signature you used before: (interaction, commandName, cooldownMs, { inChannel })
      // the helper should handle DM vs channel; in DMs, inChannel is naturally the DM itself
      try {
        await handlerReminders(interaction, COMMAND_NAME, cooldownMs, { inChannel: remindInChannel });
      } catch (e) {
        console.warn('list: handlerReminders failed:', e?.message || e);
      }
    }

    // 3) Create the ListSet (messageId filled after send)
    const set = await ListSet.create({
      guildId: interaction.guildId ?? null,
      channelId: interaction.channelId,
      ownerId: userId,
      slots,
      expiresAt
    });

    // 4) Buttons 1..5
    const buildRow = (disableAll = false, claimedIdx = null) =>
      new ActionRowBuilder().addComponents(
        ...[1, 2, 3, 4, 5].map(n => {
          const btn = new ButtonBuilder()
            .setCustomId(`listclaim:${set.id}:${n}`)
            .setLabel(String(n))
            .setStyle(ButtonStyle.Primary);
          if (disableAll) btn.setDisabled(true);
          if (claimedIdx === n) btn.setStyle(ButtonStyle.Secondary).setDisabled(true).setLabel(`${n} • Claimed`);
          return btn;
        })
      );

    const where = interaction.inGuild() ? 'this channel' : 'this DM';
    const embed = new EmbedBuilder()
      .setTitle('Mystery Card List')
      .setColor('#2f3136')
      .setDescription([
        `Click **one** number to claim a hidden card in ${where}.`,
        `You won’t know which card until after you click.`,
        '',
        `Expires in **${minutes} minutes** or when all are claimed.`
      ].join('\n'))
      .setFooter({ text: `Created by ${interaction.user.username}` });
      embed.setImage('attachment://list-blurred.png');


    const msg = await safeReply(interaction, {
  embeds: [embed],
  files: [blurredAttachment],  // 🖼️ include blurred composite
  components: [buildRow()]
});


    // 5) Save message id and schedule auto‑disable on expiry
    if (msg?.id) {
      set.messageId = msg.id;
      await set.save();

      const msUntilExpire = Math.max(0, expiresAt.getTime() - Date.now());

      setTimeout(async () => {
        try {
          const channel = await interaction.client.channels.fetch(set.channelId);
          const liveMsg = await channel.messages.fetch(set.messageId);

          const allClaimed = (await ListSet.findById(set._id))?.slots?.every(s => s.claimedBy);
          const expiredEmbed = liveMsg.embeds?.[0]
            ? EmbedBuilder.from(liveMsg.embeds[0])
            : new EmbedBuilder().setColor('#2f3136');

          expiredEmbed.setTitle(allClaimed ? 'Mystery Card List all claimed' : 'Mystery Card List expired');

          await liveMsg.edit({
            embeds: [expiredEmbed],
            components: [buildRow(true)] // disable all
          });
        } catch (e) {
          console.warn('list: auto-disable skipped:', e?.message || e);
        }
      }, msUntilExpire + 500);
    }
  }
};