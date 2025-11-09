// commands/global/list.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder
} = require('discord.js');
    const sharp = require('sharp');
const path = require('path');

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


// 🖼️ Assume each card has an image file like ./images/cards/<cardId>.png
// Adjust the path or use card.image if you have URLs
const cardImages = slots.map(s => path.resolve(`attachment://${s.card._id}.png`));

// Load, resize, and blur each card image
const blurredBuffers = await Promise.all(
  cardImages.map(async img =>
    await sharp(img)
      .resize(300, 420)  // make all same size
      .blur(25)          // adjust blur intensity (10–30 looks good)
      .toBuffer()
  )
);

// Combine all blurred images horizontally
const totalWidth = blurredBuffers.length * 300;
const composite = await sharp({
  create: {
    width: totalWidth,
    height: 420,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  }
})
  .composite(
    blurredBuffers.map((buf, i) => ({
      input: buf,
      left: i * 300,
      top: 0
    }))
  )
  .png()
  .toBuffer();

const blurredAttachment = new AttachmentBuilder(composite, { name: 'blurred-list.png' });

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
  .setImage('attachment://blurred-list.png') // 🔥 Add this line
  .setFooter({ text: `Created by ${interaction.user.username}` });

const msg = await safeReply(interaction, {
  embeds: [embed],
  files: [blurredAttachment],  // 🖼️ send the image
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