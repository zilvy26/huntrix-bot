// commands/global/list.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const safeReply = require('../../utils/safeReply');
const pickRarity = require('../../utils/rarityPicker');                    // same as /pull
const getRandomCardByRarity = require('../../utils/randomCardFromRarity'); // same as /pull
const ListSet = require('../../models/ListSet');

// 🔥 your existing cooldown utils (same as /pull & /pull10)
const cooldowns = require('../../utils/cooldownManager');
const cooldownConfig = require('../../utils/cooldownConfig'); // if you have per‑command config

// If you prefer hard‑coding: set this to 45 and delete the process.env part
const DEFAULT_MINUTES = 15;
const COMMAND_NAME = 'List';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('Create 5 mystery claim buttons for random cards')
    .setDMPermission(true),

  async execute(interaction) {
    const userId = interaction.user.id;

    // 0) Cooldown check (handler already ACK’d the interaction)
    const cooldownMs = typeof cooldownConfig?.[COMMAND_NAME] === 'number'
      ? cooldownConfig[COMMAND_NAME]
      : 60_000 * 2; // fallback: 2 minutes
    if (await cooldowns.isOnCooldown(userId, COMMAND_NAME)) {
      const ts = await cooldowns.getCooldownTimestamp(userId, COMMAND_NAME);
      return safeReply(interaction, { content: `You must wait **${ts}** before using /list again.` });
    }

    const minutes = DEFAULT_MINUTES; // ← fixed duration; users cannot change it
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
    // 1) Build 5 hidden slots (same rarity as /pull)
    const slots = [];
    for (let idx = 1; idx <= 5; idx++) {
      const rarity = pickRarity();
      const card = await getRandomCardByRarity(rarity);
      if (!card) return safeReply(interaction, { content: 'No pullable cards found right now.' });
      slots.push({ idx, cardId: card._id });
    }

    // 2) Start cooldown now that we know we can proceed
    await cooldowns.setCooldown(userId, COMMAND_NAME, cooldownMs);

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

    const where = interaction.guildId ? 'this channel' : 'this DM';
    const embed = new EmbedBuilder()
      .setTitle('Mystery Card List')
      .setColor('#2f3136')
      .setDescription([
        `Click Buttons <:en_one:1392340101547430039> - <:en_five:1392340185982828629>`,
        ``,
        '',
        ``
      ].join('\n'))
      .setFooter({ text: `Created by ${interaction.user.username}` });

    const msg = await safeReply(interaction, { embeds: [embed], components: [buildRow()] });

    // 5) Save message id and schedule auto‑disable on expiry
    if (msg?.id) {
      set.messageId = msg.id;
      await set.save();

      const msUntilExpire = Math.max(0, expiresAt.getTime() - Date.now());

      setTimeout(async () => {
        try {
          // Best effort: skip if message/channel gone
          const channel = await interaction.client.channels.fetch(set.channelId);
          const liveMsg = await channel.messages.fetch(set.messageId);

          const allClaimed = (await ListSet.findById(set._id))?.slots?.every(s => s.claimedBy);
          const expiredEmbed = liveMsg.embeds?.[0]
            ? EmbedBuilder.from(liveMsg.embeds[0])
            : new EmbedBuilder().setColor('#2f3136');

          expiredEmbed.setTitle(allClaimed ? 'Mystery List, all claimed ' : 'Mystery List, expired');

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