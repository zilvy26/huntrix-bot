const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const cooldowns = require('../../utils/cooldownManager');
const handleReminders = require('../../utils/reminderHandler');
const { safeReply } = require('../../utils/safeReply');
const MysterySession = require('../../models/MysterySession');
const crypto = require('crypto');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('karaoke')
    .setDescription('Click 3 buttons to get surprises for singing!')
    .addBooleanOption(opt =>
      opt.setName('reminder').setDescription('Remind you when cooldown ends').setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('remindinchannel').setDescription('Remind in the command channel instead of DM').setRequired(false)),

  async execute(interaction) {
    const userId = interaction.user.id;
    const commandName = 'Karaoke';
    const cooldownMs = await cooldowns.getEffectiveCooldown(interaction, commandName);

    if (await cooldowns.isOnCooldown(userId, commandName)) {
      const nextTime = await cooldowns.getCooldownTimestamp(userId, commandName);
      return safeReply(interaction, { content: `You must wait ${nextTime} before using \`/karaoke\` again.` });
    }

    await cooldowns.setCooldown(userId, commandName, cooldownMs);
    try { await handleReminders(interaction, commandName, cooldownMs); } catch {}

    // 🧮 Step 1: Generate outcomes with weighted probabilities
    const rewardWeights = {
      card_gain: 25,
      currency_gain: 35,
      currency_loss: 10,
      nothing: 30
    };
    const weightedPool = Object.entries(rewardWeights)
      .flatMap(([type, weight]) => Array(weight).fill(type));

    const outcomes = Array.from({ length: 15 }).map(() =>
      weightedPool[Math.floor(Math.random() * weightedPool.length)]
    );

    // 🧪 Step 2: Create session in DB
    const sessionId = crypto.randomBytes(6).toString('hex');
    const embed = new EmbedBuilder()
      .setTitle('Mystery\'s Karaoke Game')
      .setDescription('Choose 3 buttons to uncover how good the singing \nnotes Mystery hit. Will you get cards, currency, or nothing \nas a result?');

    const rows = [0, 1, 2].map(i => {
      return new ActionRowBuilder().addComponents(
        ...[0, 1, 2, 3, 4].map(j => {
          const idx = i * 5 + j;
          return new ButtonBuilder()
            .setCustomId(`mystery:${sessionId}:${idx}`)
            .setLabel(`${idx + 1}`)
            .setStyle(ButtonStyle.Secondary);
        })
      );
    });

    const reply = await safeReply(interaction, {
  embeds: [embed],
  components: rows,
  fetchReply: true
});

    await MysterySession.create({
      sessionId,
      userId,
      outcomes,
      clicks: [],
      messageId: reply.id
    });

    // 🕒 Step 3: Set 5-minute timeout to finalize if not all 3 clicked
    setTimeout(async () => {
      const sess = await MysterySession.findOne({ sessionId });
      if (!sess || sess.clicks.length >= 3) return;

      const resultLines = sess.clicks.map(c => `#${c.idx + 1} → ${formatResult(c.outcome)}`);
      const resultText = resultLines.join('\n') || '_You didn’t click anything._';

      try {
        await interaction.editReply({
          content: `Time's up!\n${resultText}`,
          components: disableAllComponents(reply)
        });
      } catch {}
      await MysterySession.deleteOne({ sessionId });
    }, 5 * 60 * 1000); // 5 minutes
  }
};

// 🧊 Utility: Disable all buttons
function disableAllComponents(message) {
  return message.components.map(row => {
    const newRow = new ActionRowBuilder();
    for (const btn of row.components) {
      newRow.addComponents(ButtonBuilder.from(btn).setDisabled(true));
    }
    return newRow;
  });
}

// 🧠 Display format for outcome
function formatResult(outcome) {
  const map = {
    card_gain: '+Card',
    currency_gain: '+Currency',
    currency_loss: '-Currency',
    nothing: 'Nothing'
  };
  return map[outcome] || outcome;
}
