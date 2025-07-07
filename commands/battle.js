const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const Question = require('../models/Question');
const User = require('../models/User');
const cooldowns = require('../utils/cooldownManager');
const cooldownConfig = require('../utils/cooldownConfig');
const handleReminders = require('../utils/reminderHandler');

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('battle')
    .setDescription('Start a battle question and earn rewards!')
    .addStringOption(option =>
      option.setName('difficulty')
        .setDescription('Choose your difficulty')
        .setRequired(true)
        .addChoices(
          { name: 'Demons (Easy)', value: 'easy' },
          { name: 'Hunters (Hard)', value: 'hard' }
        ))
    .addBooleanOption(opt =>
      opt.setName('reminder')
        .setDescription('Remind you when cooldown ends')
        .setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('remindinchannel')
        .setDescription('Remind in the command channel instead of DM')
        .setRequired(false)),

  async execute(interaction) {
    const userId = interaction.user.id;
    const commandName = 'battle';
    const cooldownDuration = cooldownConfig[commandName] || (2 * 60 * 60 * 1000); // 2h

    if (await cooldowns.isOnCooldown(userId, commandName)) {
      const endsAt = await cooldowns.getCooldownTimestamp(userId, commandName);
      return interaction.reply({
        content: `You must wait before battling again. Try ${endsAt}`,
        ephemeral: true
      });
    }

    await cooldowns.setCooldown(userId, commandName, cooldownDuration);
    await handleReminders(interaction, commandName, cooldownDuration);
    const questions = await Question.aggregate([
      { $match: { difficulty: interaction.options.getString('difficulty') } },
      { $sample: { size: 1 } }
    ]);

    if (!questions.length) {
      return interaction.reply({ content: 'No questions found for this difficulty.' });
    }

    const selected = questions[0];

    const buttons = new ActionRowBuilder().addComponents(
      selected.options.map((option, index) =>
        new ButtonBuilder()
          .setCustomId(`question_${index}`)
          .setLabel(option)
          .setStyle(ButtonStyle.Primary)
      )
    );

    const embed = new EmbedBuilder()
      .setTitle('Battle Question')
      .setDescription(`**${selected.question}**`)
      .setColor('#b5dff9');

    if (selected.image) embed.setImage(selected.image);

    await interaction.reply({ embeds: [embed], components: [buttons] });

    const filter = i => i.customId.startsWith('question_') && i.user.id === userId;

    const collector = interaction.channel.createMessageComponentCollector({
      filter,
      time: 45000,
      max: 1
    });

    collector.on('collect', async i => {
      await i.deferUpdate();
      const selectedIndex = parseInt(i.customId.split('_')[1]);
      const selectedAnswer = selected.options[selectedIndex];

      if (selectedAnswer === selected.correct) {
        const user = await User.findOne({ userId }) || new User({
          userId,
          username: interaction.user.username
        });

        user.correctStreak = (user.correctStreak || 0) + 1;

        let rewardPatterns = 0;
        let rewardSopop = 0;

        if (interaction.options.getString('difficulty') === 'easy') {
          rewardPatterns = getRandomInt(600, 850);
        } else {
          rewardPatterns = getRandomInt(1000, 1250);
          rewardSopop = getRandomInt(0, 1);
        }

        if (Math.random() < 0.05) rewardSopop++;

        let streakBonus = '';
        if (user.correctStreak % 3 === 0) {
          rewardPatterns += 200;
          streakBonus = '\n🔥 **Streak bonus activated!** Extra rewards granted!';
        }

        user.patterns += rewardPatterns;
        user.sopop += rewardSopop;
        await user.save();

        await interaction.editReply({
          content: `Correct! You earned <:ehx_patterns:1389584144895315978> **${rewardPatterns} Patterns**${rewardSopop ? ` and <:ehx_sopop:1389584273337618542> **${rewardSopop} Sopop**` : ''}.\nCurrent streak: **${user.correctStreak}**${streakBonus}`,
          embeds: [],
          components: []
        });

      } else {
        await User.findOneAndUpdate({ userId }, { $set: { correctStreak: 0 } });
        await interaction.editReply({
          content: `Incorrect! The correct answer was **${selected.correct}**.\nYour streak has been reset.`,
          embeds: [],
          components: []
        });
      }
    });

    collector.on('end', collected => {
      if (collected.size === 0) {
        interaction.editReply({
          content: `Time's up! No answer selected.`,
          embeds: [],
          components: []
        });
      }
    });
  }
};