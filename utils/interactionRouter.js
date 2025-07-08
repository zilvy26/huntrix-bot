const User = require('../models/User');
const Question = require('../models/Question');

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = async function interactionRouter(interaction) {
  const { customId, user } = interaction;

  // 🎯 Battle Answer Buttons
  if (customId.startsWith('question_')) {
    const selectedIndex = parseInt(customId.split('_')[1]);

    try {
      const message = await interaction.message.fetch();
      const embed = message.embeds[0];
      if (!embed || !embed.description) {
        return interaction.reply({ content: '❌ Question data missing.' });
      }

      const questionText = embed.description.replace(/\*\*/g, '');
      const selected = await Question.findOne({ question: questionText });
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
        if (userDoc.correctStreak % 3 === 0) {
          rewardPatterns += 200;
          streakBonus = '\n🔥 **Streak bonus activated!** Extra rewards granted!';
        }

        userDoc.patterns += rewardPatterns;
        userDoc.sopop += rewardSopop;
        await userDoc.save();

        await interaction.editReply({
          content: `✅ Correct! You earned <:ehx_patterns:1389584144895315978> **${rewardPatterns} Patterns**${rewardSopop ? ` and <:ehx_sopop:1389584273337618542> **${rewardSopop} Sopop**` : ''}.\nCurrent streak: **${userDoc.correctStreak}**${streakBonus}`,
          embeds: [],
          components: []
        });

      } else {
        await User.findOneAndUpdate({ userId: user.id }, { $set: { correctStreak: 0 } });
        await interaction.editReply({
          content: `❌ Incorrect! The correct answer was **${selected.correct}**.\nYour streak has been reset.`,
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

  // 📘 Binder navigation buttons
if (customId === 'binder_prev' || customId === 'binder_next') {
  const pageDelta = customId === 'binder_next' ? 1 : -1;

  try {
    const userId = interaction.user.id;
    const drawBinder = require('./drawBinder');
    const { AttachmentBuilder } = require('discord.js');

    const user = await User.findOne({ userId });
    if (!user || !user.binder) {
      return interaction.reply({ content: '❌ No binder found.', ephemeral: true });
    }

    const currentPage = parseInt(interaction.message.embeds[0]?.footer?.text?.match(/Page (\d+)/)?.[1]) || 1;
    let newPage = currentPage + pageDelta;

    if (newPage < 1) newPage = 3;
    if (newPage > 3) newPage = 1;

    const buffer = await drawBinder(userId, newPage);
    const image = new AttachmentBuilder(buffer, { name: `binder_page${newPage}.png` });

    await interaction.update({
      content: `📘 ${interaction.user.username}'s Binder — Page ${newPage}`,
      files: [image]
    });
  } catch (err) {
    console.error('❌ Binder button error:', err);
    return interaction.reply({ content: '❌ Error handling binder navigation.', ephemeral: true });
  }
    }

    // ⬇️ Template select menu handler (select_template)
router.select('select_template', async (interaction) => {
  const UserRecord = require('../models/UserRecord');
  const templateOptions = require('../data/templateOptions');

  const user = await User.findOne({ userId });
  if (!user) return interaction.reply({ content: 'User not found.' });

  const selectedId = interaction.values[0];
  const template = templateOptions.find(t => t.id === selectedId);

  if (!template) {
    return interaction.reply({ content: 'Invalid template selected.' });
  }

  if (user.templatesOwned?.includes(template.id)) {
    return interaction.reply({ content: `You already own **${template.name}**.` });
  }

  if (user.sopop < template.price) {
    return interaction.reply({
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

  return interaction.reply({
    content: `You bought **${template.name}** for ${template.price.toLocaleString()} Sopop!`,
    
  });
    });

    // Confirm or Cancel Card Creation/Edit
router.button('confirm', async (interaction) => {
  await interaction.deferUpdate().catch(() => {});

  const originalMessage = interaction.message;
  const embed = originalMessage.embeds?.[0];
  if (!embed) return interaction.followUp({ content: '⚠️ Missing card embed data.', ephemeral: true });

  const cardCodeField = embed.fields.find(f => f.name === 'Code');
  const nameField = embed.fields.find(f => f.name === 'Name');
  const categoryField = embed.fields.find(f => f.name === 'Category');
  const designerField = embed.fields.find(f => f.name === 'Designer');
  const groupField = embed.fields.find(f => f.name === 'Group');
  const eraField = embed.fields.find(f => f.name === 'Era');
  const imgurField = embed.fields.find(f => f.name === 'Imgur Link');

  if (!cardCodeField || !nameField || !categoryField || !designerField) {
    return interaction.followUp({ content: '⚠️ Incomplete embed data to confirm.', ephemeral: true });
  }

  const Card = require('../models/Card');
  const cardExists = await Card.findOne({ cardCode: cardCodeField.value });
  if (cardExists) {
    return interaction.followUp({ content: `⚠️ A card with code \`${cardCodeField.value}\` already exists.`, ephemeral: true });
  }

  await Card.create({
    cardCode: cardCodeField.value,
    name: nameField.value,
    category: categoryField.value,
    rarity: embed.title?.match(/★/g)?.length || 0,
    emoji: null,
    designerId: designerField.value.replace(/[<@>]/g, ''),
    discordPermalinkImage: embed.image?.url,
    imgurImageLink: imgurField?.value || null,
    pullable: true,
    group: groupField?.value === '-' ? null : groupField?.value,
    era: eraField?.value === '-' ? null : eraField?.value
  });

  await interaction.editReply({
    content: `✅ Card \`${cardCodeField.value}\` created successfully.`,
    embeds: [],
    components: []
  });
});

router.button('cancel', async (interaction) => {
  await interaction.deferUpdate().catch(() => {});
  await interaction.editReply({
    content: '❌ Card creation cancelled.',
    embeds: [],
    components: []
  });
});
};