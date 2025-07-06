const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const Question = require('../models/Question');
const User = require('../models/User');
const {
  isOnCooldown,
  getCooldownTimestamp,
  setCooldown
} = require('../utils/cooldownManager');
const { battle: battleCooldown } = require('../utils/cooldownConfig');

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
        )),

  async execute(interaction) {
    const userId = interaction.user.id;
    const difficulty = interaction.options.getString('difficulty');

    if (isOnCooldown(userId, 'battle')) {
      const endsAt = getCooldownTimestamp(userId, 'battle');
      return interaction.reply({
        content: `⏳ You must wait before battling again. Try ${endsAt}`,
        
      });
    }

    setCooldown(userId, 'battle', battleCooldown);

    const questions = await Question.aggregate([
      { $match: { difficulty } },
      { $sample: { size: 1 } }
    ]);

    if (!questions.length) {
      return interaction.reply({ content: '❌ No questions found for this difficulty.' });
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
        // Load or create user
        const user = await User.findOne({ userId }) || new User({
          userId,
          username: interaction.user.username
        });

        user.correctStreak = (user.correctStreak || 0) + 1;

        let rewardPatterns = 0;
        let rewardSopop = 0;

        if (difficulty === 'easy') {
          rewardPatterns = getRandomInt(75, 150);
        } else if (difficulty === 'hard') {
          rewardPatterns = getRandomInt(250, 400);
          rewardSopop = getRandomInt(0, 2);
        }

        // 🎲 5% chance bonus
        if (Math.random() < 0.05) rewardSopop++;

        // 🔥 Streak bonus every 3 wins
        let streakBonus = '';
        if (user.correctStreak % 3 === 0) {
          rewardPatterns += 200;
          rewardSopop += 0;
          streakBonus = '\n🔥 **Streak bonus activated!** Extra rewards granted!';
        }

        // Save rewards
        user.patterns += rewardPatterns;
        user.sopop += rewardSopop;
        await user.save();

        await interaction.editReply({
          content: `✅ Correct! You earned <:ehx_patterns:1389584144895315978> **+${rewardPatterns} Patterns**${rewardSopop ? ` and <:ehx_sopop:1389584273337618542> **+${rewardSopop} Sopop**` : ''}.\n🔥 Current streak: **${user.correctStreak}**${streakBonus}`,
          embeds: [],
          components: []
        });

      } else {
        // Reset streak
        await User.findOneAndUpdate({ userId }, { $set: { correctStreak: 0 } });
        await interaction.editReply({
          content: `❌ Incorrect! The correct answer was **${selected.correct}**.\n💥 Your streak has been reset.`,
          embeds: [],
          components: []
        });
      }
    });

    collector.on('end', collected => {
      if (collected.size === 0) {
        interaction.editReply({
          content: `⏱️ Time's up! No answer selected.`,
          embeds: [],
          components: []
        });
      }
    });
  }
};