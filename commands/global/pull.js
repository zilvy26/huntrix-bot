// commands/global/pull.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserInventory = require('../../models/UserInventory');
const getRandomCardByRarity = require('../../utils/randomCardFromRarity');
const InventoryItem = require('../../models/InventoryItem');
const pickRarity = require('../../utils/rarityPicker');
const generateStars = require('../../utils/starGenerator');
const cooldowns = require('../../utils/cooldownManager');
const handleReminders = require('../../utils/reminderHandler');
const UserRecord = require('../../models/UserRecord');
const { safeReply } = require('../../utils/safeReply'); // compat export

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pull')
    .setDescription('Pull a random card from any pullable category')
    .addBooleanOption(opt =>
      opt.setName('reminder').setDescription('Remind you when cooldown ends').setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('remindinchannel').setDescription('Remind in the command channel instead of DM').setRequired(false)),

  async execute(interaction) {
    const userId = interaction.user.id;
    const commandName = 'Pull';

    // Handler already did deferReply(); we only send via safeReply()

    // Cooldown check (no set yet)
    const cooldownMs = await cooldowns.getEffectiveCooldown(interaction, commandName);
    if (await cooldowns.isOnCooldown(userId, commandName)) {
      const nextTime = await cooldowns.getCooldownTimestamp(userId, commandName);
      return safeReply(interaction, { content: `You must wait ${nextTime} before using \`/pull\` again.` });
    }

    // Now that the interaction is ACKed (by handler), it's safe to start the cooldown
    await cooldowns.setCooldown(userId, commandName, cooldownMs);

    const rarity = await pickRarity();
    const card = await getRandomCardByRarity(rarity);

    if (!card) {
      return safeReply(interaction, { content: `No pullable cards found for rarity ${rarity}.` });
    }

// Atomically add +1 and get the updated quantity in one round-trip
const updated = await InventoryItem.findOneAndUpdate(
  { userId: interaction.user.id, cardCode: card.cardCode },
  { $inc: { quantity: 1 } },
  {
    upsert: true,
    new: true,                 // return the post-update doc
    setDefaultsOnInsert: true,
    projection: { quantity: 1, _id: 0 }
  }
);

const copies = updated.quantity;

    // Embed + image
    const stars = generateStars({ rarity: card.rarity, overrideEmoji: card.emoji || '<:fullstar:1387609456824680528>' });
    const imageSource = card.localImagePath ? `attachment://${card._id}.png`
        : (card.discordPermalinkImage || card.imgurImageLink);
    const files = card.localImagePath ? [{ attachment: card.localImagePath, name: `${card._id}.png` }] : [];

    const embed = new EmbedBuilder()
      .setTitle(stars)
      .setDescription([
        `**Group:** ${card.group}`,
        `**Name:** ${card.name}`,
        ...(card.category?.toLowerCase() === 'kpop' ? [`**Era:** ${card.era}`] : []),
        `**Code:** \`${card.cardCode}\``,
        `**Copies:** ${copies}`
      ].join('\n'))
      .setImage(imageSource)
      .setFooter({ text: `Pulled ${new Date().toUTCString()}` });

    // Reminder and audit (don’t block the reply on failure)
    try { await handleReminders(interaction, commandName, cooldownMs); } catch {}
    try {
      await UserRecord.create({
        userId, type: 'pull',
        detail: `Pulled ${card.name} (${card.cardCode}) [${card.rarity}]`
      });
    } catch {}

    return safeReply(interaction, { embeds: [embed], files });
  }
};