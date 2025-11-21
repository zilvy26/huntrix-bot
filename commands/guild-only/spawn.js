const {
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder
} = require("discord.js");

const { safeReply } = require("../../utils/safeReply");
const InventoryItem = require("../../models/InventoryItem");
const User = require("../../models/User");
const Card = require("../../models/Card");
const generateStars = require("../../utils/starGenerator");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("spawn")
    .setDescription("Drop multi rewards for the fastest people to claim")
    .setDefaultMemberPermissions("0")
    .addStringOption(opt =>
      opt
        .setName("reward")
        .setDescription("Comma list: card codes + currency (patterns, sopop)")
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt
        .setName("amount")
        .setDescription("Default currency amount (used if specific amounts are not given)")
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt
        .setName("patterns_amount")
        .setDescription("Custom amount of patterns to drop")
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt
        .setName("sopop_amount")
        .setDescription("Custom amount of sopop to drop")
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt
        .setName("limit")
        .setDescription("How many people can claim (default: 1)")
        .setRequired(false)
    ),

  async execute(interaction) {
    const ALLOWED_ROLE_ID = "1386797486680703036";
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return safeReply(interaction, {
        content: "Only authorized staff can use this command.",
      });
    }

    // -------- INPUTS --------
    const rewardInput = interaction.options.getString("reward");
    const defaultAmount = interaction.options.getInteger("amount") ?? 1;
    const patternsAmount = interaction.options.getInteger("patterns_amount");
    const sopopAmount = interaction.options.getInteger("sopop_amount");
    const claimLimit = interaction.options.getInteger("limit") ?? 1;

    const rewardList = rewardInput
      .split(",")
      .map(v => v.trim().toLowerCase())
      .filter(Boolean);

    // Separate data
    const cardCodes = [];
    const currencyRewards = { patterns: 0, sopop: 0 };

    for (const entry of rewardList) {
      if (entry === "patterns") {
        currencyRewards.patterns += patternsAmount ?? defaultAmount;
      } else if (entry === "sopop") {
        currencyRewards.sopop += sopopAmount ?? defaultAmount;
      } else {
        cardCodes.push(entry);
      }
    }

    // Load cards in one query
    const cards = await Card.find({
      cardCode: { $in: cardCodes }
    });

    if (cards.length !== cardCodes.length) {
      return safeReply(interaction, {
        content: "One or more card codes were invalid.",
      });
    }

    // -------- BUILD DISPLAY EMBED --------
    const rewardLines = [];

    for (const c of cards) {
      rewardLines.push(`• **${c.name}** (\`${c.cardCode}\`)`);
    }

    if (currencyRewards.patterns > 0)
      rewardLines.push(`• **${currencyRewards.patterns} Patterns**`);

    if (currencyRewards.sopop > 0)
      rewardLines.push(`• **${currencyRewards.sopop} Sopop**`);

    const embed = new EmbedBuilder()
      .setTitle(`Reward Drop!`)
      .setDescription(
        [
          `First **${claimLimit}** people to click will receive:\n`,
          ...rewardLines
        ].join("\n")
      )
      .setColor("#ff4444");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("claim_multi")
        .setLabel("Claim!")
        .setStyle(ButtonStyle.Success)
    );

    const dropMsg = await safeReply(interaction, {
      embeds: [embed],
      components: [row],
    });

    // ---------- CLAIM LOGIC ----------
    let claimedUsers = 0;

    const collector = dropMsg.createMessageComponentCollector({
      filter: i => !i.user.bot,
      time: 15000,
    });

    collector.on("collect", async i => {
      if (claimedUsers >= claimLimit) {
        return i.reply({
          content: "Claim limit reached!",
          ephemeral: true,
        });
      }

      claimedUsers++;

      const userId = i.user.id;
      const bulkOps = [];

      // Add cards
      for (const c of cards) {
        bulkOps.push({
          updateOne: {
            filter: { userId, cardCode: c.cardCode },
            update: { $inc: { quantity: 1 } },
            upsert: true,
          },
        });
      }

      // Add currency
      if (currencyRewards.patterns > 0 || currencyRewards.sopop > 0) {
        bulkOps.push({
          updateOne: {
            filter: { userId },
            update: {
              $inc: {
                patterns: currencyRewards.patterns,
                sopop: currencyRewards.sopop,
              },
            },
            upsert: true,
          },
        });
      }

      await InventoryItem.bulkWrite(bulkOps);

      await i.reply({
        content: `${i.user} claimed the drop!`,
        ephemeral: true,
      });

      if (claimedUsers >= claimLimit) {
        collector.stop("limit_reached");
      }
    });

    collector.on("end", async (_, reason) => {
      const disabledBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("claim_multi")
          .setLabel("Claim!")
          .setStyle(ButtonStyle.Success)
          .setDisabled(true)
      );

      if (reason === "time") {
        return dropMsg.edit({
          content: "Drop expired, nobody claimed in time.",
          components: [disabledBtn],
        });
      }

      if (reason === "limit_reached") {
        return dropMsg.edit({
          content: "Claim limit reached! Drop is closed.",
          components: [disabledBtn],
        });
      }

      dropMsg.edit({ components: [disabledBtn] }).catch(() => {});
    });
  },
};
