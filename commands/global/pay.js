const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');
const {safeReply} = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Send patterns to another user')
    .addUserOption(opt =>
      opt.setName('recipient')
        .setDescription('User you want to pay')
        .setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('patterns')
        .setDescription('Amount of patterns to send')
        .setMinValue(1)
        .setRequired(false)),

  async execute(interaction) {
    const senderId = interaction.user.id;
    const recipient = interaction.options.getUser('recipient');
    const patternsToSend = interaction.options.getInteger('patterns') || 0;

    if (!patternsToSend ) {
      return safeReply(interaction, { content: 'You must send at least one currency type.' });
    }

    if (recipient.bot || recipient.id === senderId) {
      return safeReply(interaction, { content: 'You cannot pay yourself or a bot.' });
    }

    const [sender, receiver] = await Promise.all([
      User.findOne({ userId: senderId }),
      User.findOneAndUpdate({ userId: recipient.id }, {}, { upsert: true, new: true })
    ]);

    if (!sender || (!sender.patterns)) {
      return safeReply(interaction, { content: 'You have no currency to send.' });
    }

    if (sender.patterns < patternsToSend ) {
      return safeReply(interaction, { content: 'You don’t have enough balance to complete this payment.' });
    }

    // Perform the transaction
    sender.patterns -= patternsToSend;
  

    receiver.patterns = (receiver.patterns || 0) + patternsToSend;

    await Promise.all([sender.save(), receiver.save()]);

    const embed = new EmbedBuilder()
      .setTitle('Payment Complete')
      .setColor('#2f3136')
      .setDescription([
        `You sent <@${recipient.id}>:`,
        patternsToSend ? `• <:ehx_patterns:1389584144895315978> **${patternsToSend}** Patterns` : null,
      ].filter(Boolean).join('\n'))
      .setFooter({ text: `Balance updated for both users` });

      const UserRecord = require('../../models/UserRecord'); // Make sure it's imported

await UserRecord.create({
  userId: senderId,
  type: 'pay',
  targetId: recipient.id,
  detail: `Sent <:ehx_patterns:1389584144895315978> ${patternsToSend} to <@${recipient.id}>`
});

await UserRecord.create({
  userId: recipient.id,
  type: 'receive',
  targetId: senderId,
  detail: `Received <:ehx_patterns:1389584144895315978> ${patternsToSend} from <@${senderId}>`
});

    return safeReply(interaction, { embeds: [embed] });
  }
};