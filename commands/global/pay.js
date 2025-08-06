const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');
const safeReply = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Send patterns or sopop to another user')
    .addUserOption(opt =>
      opt.setName('recipient')
        .setDescription('User you want to pay')
        .setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('patterns')
        .setDescription('Amount of patterns to send')
        .setMinValue(1)
        .setRequired(false))
    .addIntegerOption(opt =>
      opt.setName('sopop')
        .setDescription('Amount of sopop to send')
        .setMinValue(1)
        .setRequired(false)),

  async execute(interaction) {
    const senderId = interaction.user.id;
    const recipient = interaction.options.getUser('recipient');
    const patternsToSend = interaction.options.getInteger('patterns') || 0;
    const sopopToSend = interaction.options.getInteger('sopop') || 0;

    if (!patternsToSend && !sopopToSend) {
      return interaction.reply({ content: '❌ You must send at least one currency type.' });
    }

    if (recipient.bot || recipient.id === senderId) {
      return interaction.reply({ content: '❌ You cannot pay yourself or a bot.' });
    }

    const [sender, receiver] = await Promise.all([
      User.findOne({ userId: senderId }),
      User.findOneAndUpdate({ userId: recipient.id }, {}, { upsert: true, new: true })
    ]);

    if (!sender || (!sender.patterns && !sender.sopop)) {
      return interaction.reply({ content: '❌ You have no currency to send.' });
    }

    if (sender.patterns < patternsToSend || sender.sopop < sopopToSend) {
      return interaction.reply({ content: '❌ You don’t have enough balance to complete this payment.' });
    }

    // Perform the transaction
    sender.patterns -= patternsToSend;
    sender.sopop -= sopopToSend;

    receiver.patterns = (receiver.patterns || 0) + patternsToSend;
    receiver.sopop = (receiver.sopop || 0) + sopopToSend;

    await Promise.all([sender.save(), receiver.save()]);

    const embed = new EmbedBuilder()
      .setTitle('Payment Complete')
      .setColor('#2f3136')
      .setDescription([
        `You sent ${recipient}:`,
        patternsToSend ? `• <:ehx_patterns:1389584144895315978> **${patternsToSend}** Patterns` : null,
        sopopToSend ? `• <:ehx_sopop:1389584273337618542> **${sopopToSend}** Sopop` : null
      ].filter(Boolean).join('\n'))
      .setFooter({ text: `Balance updated for both users` });

      const UserRecord = require('../../models/UserRecord'); // Make sure it's imported

await UserRecord.create({
  userId: senderId,
  type: 'pay',
  targetId: recipient.id,
  detail: `Sent <:ehx_patterns:1389584144895315978> ${patternsToSend} and <:ehx_sopop:1389584273337618542> ${sopopToSend} to <@${recipient.id}>`
});

await UserRecord.create({
  userId: recipient.id,
  type: 'receive',
  targetId: senderId,
  detail: `Received <:ehx_patterns:1389584144895315978> ${patternsToSend} and <:ehx_sopop:1389584273337618542> ${sopopToSend} from <@${interaction.user.tag}>`
});

    return interaction.reply({ embeds: [embed] });
  }
};