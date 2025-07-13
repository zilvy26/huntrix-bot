const User = require('../models/User');
const Question = require('../models/Question');
const mongoose = require('mongoose');

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = async function interactionRouter(interaction) {
  const { customId, user } = interaction;

  // 🎯 Battle Answer Buttons
  if (customId.startsWith('question')) {
  const [, questionId, selectedIndexRaw] = customId.split('_');
  const selectedIndex = parseInt(selectedIndexRaw);

  if (!mongoose.Types.ObjectId.isValid(questionId)) {
  return interaction.reply({
    content: '❌ Invalid question ID format.',
  });
}

    try {
      const message = await interaction.message.fetch();
      const embed = message.embeds[0];
      if (!embed || !embed.description) {
        return interaction.reply({ content: '❌ Question data missing.' });
      }

      const selected = await Question.findById(questionId);
    if (!selected) return interaction.reply({ content: '❌ Could not find the question in database.' });

    const selectedAnswer = selected.options[selectedIndex];
      await interaction.deferUpdate();

      const userDoc = await User.findOne({ userId: user.id }) || new User({
        userId: user.id,
        username: user.username
      });

      if (selectedAnswer === selected.correct) {
        userDoc.correctStreak = (userDoc.correctStreak || 0) + 1;

        let rewardPatterns = 0;
        let rewardSopop = 0;

        if (selected.difficulty === 'easy') {
          rewardPatterns = getRandomInt(600, 850);
        } else {
          rewardPatterns = getRandomInt(1000, 1250);
          rewardSopop = getRandomInt(0, 1);
        }

        if (Math.random() < 0.05) rewardSopop++;

        let streakBonus = '';
        if (userDoc.correctStreak % 10 === 0) {
          rewardPatterns += 750;
          streakBonus = '\n**Streak bonus activated!** Extra rewards granted!';
        }

        userDoc.patterns += rewardPatterns;
        userDoc.sopop += rewardSopop;
        await userDoc.save();

        await interaction.editReply({
          content: `Correct! You earned <:ehx_patterns:1389584144895315978> **${rewardPatterns} Patterns**${rewardSopop ? ` and <:ehx_sopop:1389584273337618542> **${rewardSopop} Sopop**` : ''}.\nCurrent streak: **${userDoc.correctStreak}**${streakBonus}`,
          embeds: [],
          components: []
        });

      } else {
        await User.findOneAndUpdate({ userId: user.id }, { $set: { correctStreak: 0 } });
        await interaction.editReply({
          content: `Incorrect! The correct answer was **${selected.correct}**.\nYour streak has been reset.`,
          embeds: [],
          components: []
        });
      }
    } catch (err) {
      console.error('❌ Error handling battle button:', err);
      return interaction.reply({ content: 'An error occurred processing your answer.'});
    }
  }

  // Universal navigation pattern for paged embeds (standard)
  const navPattern = /^(first|prev|next|last)$/;
  if (navPattern.test(customId)) {
    const pageData = interaction.message.embeds?.[0]?.footer?.text?.match(/Page (\d+)\/(\d+)/);
    if (!pageData) return;

    let [ , currentPage, totalPages ] = pageData.map(Number);
    if (customId === 'first') currentPage = 1;
    if (customId === 'prev') currentPage = Math.max(1, currentPage - 1);
    if (customId === 'next') currentPage = Math.min(totalPages, currentPage + 1);
    if (customId === 'last') currentPage = totalPages;

    // Simulate updated content (replace with real generator if needed)
    const updatedEmbed = JSON.parse(JSON.stringify(interaction.message.embeds[0]));
    updatedEmbed.footer.text = `Page ${currentPage}/${totalPages}`;
    updatedEmbed.description = `📄 This is page ${currentPage}.`;

    return interaction.update({ embeds: [updatedEmbed] });
  }

  // Navigation for "stall" prefixed embeds (like battle history)
  const stallPattern = /^(stall_first|stall_prev|stall_next|stall_last)$/;
  if (stallPattern.test(customId)) {
    const match = interaction.message.embeds?.[0]?.footer?.text?.match(/Stall Page (\d+)\/(\d+)/);
    if (!match) return;

    let [ , currentPage, totalPages ] = match.map(Number);
    if (customId === 'stall_first') currentPage = 1;
    if (customId === 'stall_prev') currentPage = Math.max(1, currentPage - 1);
    if (customId === 'stall_next') currentPage = Math.min(totalPages, currentPage + 1);
    if (customId === 'stall_last') currentPage = totalPages;

    const updatedEmbed = JSON.parse(JSON.stringify(interaction.message.embeds[0]));
    updatedEmbed.footer.text = `Stall Page ${currentPage}/${totalPages}`;
    updatedEmbed.description = `🐌 This is stall page ${currentPage}.`;

    return interaction.update({ embeds: [updatedEmbed] });
  }

    // ⬇️ Template select menu handler (select_template)
    if (customId === 'select_template') {
        await interaction.deferReply();
  const UserRecord = require('../models/UserRecord');
  const templateOptions = require('../data/templateOptions');
  const userId = interaction.user.id;
  const user = await User.findOne({ userId });
  if (!user) return interaction.editReply({ content: 'User not found.' });

  const selectedId = interaction.values[0];
  const template = templateOptions.find(t => t.id === selectedId);

  if (!template) {
    return interaction.editReply({ content: 'Invalid template selected.' });
  }

  if (user.templatesOwned?.includes(template.id)) {
    return interaction.editReply({ content: `You already own **${template.name}**.` });
  }

  if (user.sopop < template.price) {
    return interaction.editReply({
      content: `You need ${template.price.toLocaleString()} Sopop (you have ${user.sopop.toLocaleString()}).`,
      
    });
  }

  user.sopop -= template.price;
  user.templatesOwned = [...(user.templatesOwned || []), template.id];
  await user.save();

  await UserRecord.create({
    userId,
    type: 'templatepurchase',
    detail: `Bought ${template.name} for ${template.price}`
  });

  return interaction.editReply({
    content: `You bought **${template.name}** for ${template.price.toLocaleString()} Sopop!`,
    
  });
    };



    if (customId.startsWith('rehearsal')) {
  const index = parseInt(interaction.customId.split('_')[1], 10);
  const userId = interaction.user.id;

  await interaction.deferUpdate().catch(() => {});

  try {
    const UserInventory = require('../models/UserInventory');
    const UserRecord = require('../models/UserRecord');
    const giveCurrency = require('./giveCurrency');

    // Pull 3 random cards just like in the original command
    const cards = interaction.client.cache?.rehearsal?.[userId];
if (!cards || cards.length < 3) {
  return interaction.followUp({ content: '❌ Rehearsal session not found or expired.', ephemeral: true });
}

    if (cards.length < 3) {
      return interaction.followUp({ content: 'Not enough pullable cards.', ephemeral: true });
    }

    const selected = cards[index];
    const sopop = Math.random() < 0.58 ? (Math.random() < 0.75 ? 1 : 2) : 0;
    await giveCurrency(userId, { sopop });

    let inv = await UserInventory.findOne({ userId });
    if (!inv) inv = await UserInventory.create({ userId, cards: [] });

    const existing = inv.cards.find(c => c.cardCode === selected.cardCode);
    let copies = 1;
    if (existing) {
      existing.quantity += 1;
      copies = existing.quantity;
    } else {
      inv.cards.push({ cardCode: selected.cardCode, quantity: 1 });
    }
    await inv.save();

    await UserRecord.create({
      userId,
      type: 'rehearsal',
      detail: `Chose ${selected.name} (${selected.cardCode}) [${selected.rarity}]`
    });

    const { EmbedBuilder } = require('discord.js');
    const resultEmbed = new EmbedBuilder()
      .setTitle(`You chose: ${selected.name}`)
      .setDescription([
        `**Rarity:** ${selected.rarity}`,
        `**Name:** ${selected.name}`,
        ...(selected.category?.toLowerCase() === 'kpop' ? [`**Era:** ${selected.era}`] : []),
        `**Group:** ${selected.group}`,
        `**Code:** \`${selected.cardCode}\``,
        `**Copies Owned:** ${copies}`,
        `\n__Reward__:\n${sopop ? `• <:ehx_sopop:1389584273337618542> **${sopop}** Sopop` : '• <:ehx_sopop:1389584273337618542> 0 Sopop'}`
      ].join('\n'))
      .setImage(selected.discordPermalinkImage || selected.imgurImageLink)
      .setColor('#FFD700');

    await interaction.editReply({
      embeds: [resultEmbed],
      components: [],
      files: []
    });
  } catch (err) {
    console.error('Rehearsal button error:', err);
    await interaction.followUp({ content: 'Something went wrong while selecting your card.', ephemeral: true }).catch(() => {});
  }
}

const showcasePattern = /^(show_first|show_prev|show_next|show_last)$/;
if (showcasePattern.test(customId)) {
  const userId = interaction.user.id;
  const allEmbeds = interaction.client.cache?.showcase?.[userId];

  if (!allEmbeds?.length) {
    return interaction.update({
      content: '❌ Showcase session expired or not found.',
      embeds: [],
      components: []
    });
  }

  const currentEmbed = interaction.message.embeds[0];
  let current = allEmbeds.findIndex(e => e.data.title === currentEmbed.title && e.data.description === currentEmbed.description);

  if (current === -1) current = 0;

  if (customId === 'show_first') current = 0;
  else if (customId === 'show_prev') current = (current - 1 + allEmbeds.length) % allEmbeds.length;
  else if (customId === 'show_next') current = (current + 1) % allEmbeds.length;
  else if (customId === 'show_last') current = allEmbeds.length - 1;

  return interaction.update({
    embeds: [allEmbeds[current]],
    components: [interaction.message.components[0]]
  });
}

};