const User = require('../models/User');
const Question = require('../models/Question');
const mongoose = require('mongoose');
const { AttachmentBuilder } = require('discord.js');
const safeReply = require('../utils/safeReply');
const autoDefer = require('../utils/autoDefer');

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = async function interactionRouter(interaction) {
  const { customId, user } = interaction;

  let message;

  // 🎯 Battle Answer Buttons
  if (customId.startsWith('question')) {

try {
  // Prefer interaction.message if available (works for buttons)
  message = interaction.message || await interaction.fetchReply();
} catch (err) {
  console.warn('⚠️ Failed to fetch message:', err.message);
  return safeReply(interaction, {
    content: '⚠️ This interaction has expired or can’t be accessed.',
    flags: 1 << 6
  });
}

if (!message) {
  return safeReply(interaction, {
    content: '❌ Could not find the message for this interaction.',
    flags: 1 << 6
  });
}

// Ensure only the original user interacts
if (message.interaction?.user?.id && interaction.user.id !== message.interaction.user.id) {
  return safeReply(interaction, {
    content: 'These buttons are not yours.',
    flags: 1 << 6
  });
}
await autoDefer(interaction, 'update');
  const [, questionId, selectedIndexRaw] = customId.split('_');
  const selectedIndex = parseInt(selectedIndexRaw);

  if (!mongoose.Types.ObjectId.isValid(questionId)) {
  return safeReply(interaction, {
    content: '❌ Invalid question ID format.',
  });
}

    try {
      try {
  // Prefer interaction.message if available (works for buttons)
  message = interaction.message || await interaction.fetchReply();
} catch (err) {
  console.warn('⚠️ Failed to fetch message:', err.message);
  return safeReply(interaction, {
    content: '⚠️ This interaction has expired or can’t be accessed.',
    flags: 1 << 6
  });
}

if (!message) {
  return safeReply(interaction, {
    content: '❌ Could not find the message for this interaction.',
    flags: 1 << 6
  });
}
      const embed = message.embeds[0];
      if (!embed || !embed.description) {
        return safeReply(interaction, { content: '❌ Question data missing.' });
      }

      const selected = await Question.findById(questionId);
    if (!selected) return safeReply(interaction, { content: '❌ Could not find the question in database.' });

    const selectedAnswer = selected.options[selectedIndex];
      // await interaction.deferUpdate();

      const userDoc = await User.findOne({ userId: user.id }) || new User({
        userId: user.id,
        username: user.username
      });

      if (selectedAnswer === selected.correct) {
        userDoc.correctStreak = (userDoc.correctStreak || 0) + 1;

        let rewardPatterns = 0;
        let rewardSopop = 0;

        if (selected.difficulty === 'easy') {
      rewardPatterns = getRandomInt(800, 1000);
        if (Math.random() < 0.15) rewardSopop = 1; // 15% chance
      } else if (selected.difficulty === 'hard') {
      rewardPatterns = getRandomInt(1100, 1325);
        if (Math.random() < 0.22) rewardSopop = 1; // 22% chance
      } else if (selected.difficulty === 'impossible') {
      rewardPatterns = getRandomInt(1425, 1675);
        if (Math.random() < 0.31) rewardSopop = 1; // 31% chance
      }

        let streakBonus = '';
        if (userDoc.correctStreak % 25 === 0) {
          rewardPatterns += 1250;
          rewardSopop += 1;
          streakBonus = '\n**Streak bonus activated!** Extra rewards granted!';
        }

        userDoc.patterns += rewardPatterns;
        userDoc.sopop += rewardSopop;
        await userDoc.save();

        await interaction.editReply({
          content: `Correct! You earned <:ehx_patterns:1389584144895315978> **${rewardPatterns} Patterns**${rewardSopop ? ` and <:ehx_sopop:1389584273337618542> **${rewardSopop} Sopop**` : ''}.\nCurrent streak: **${userDoc.correctStreak}**${streakBonus}`,
          embeds: [],
          components: [],
          files: []
        });

      } else {
        await User.findOneAndUpdate({ userId: user.id }, { $set: { correctStreak: 0 } });
        await interaction.editReply({
          content: `Incorrect! The correct answer was **${selected.correct}**.\nYour streak has been reset.`,
          embeds: [],
          components: [],
          files: []
        });

        if (interaction.deferred || interaction.replied) {
  try {
    await interaction.editReply({ components: [] });
  } catch (err) {
    console.warn('editReply failed:', err.message);
  }
}
      }
    } catch (err) {
      console.error('❌ Error handling battle button:', err);
      return safeReply(interaction, { content: 'An error occurred processing your answer.'});
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
    updatedEmbed.description = `This is page ${currentPage}.`;

    return interaction.update({ embeds: [updatedEmbed] });
  }

  // Navigation for "stall" prefixed embeds (like battle history)
const stallPattern = /^(stall_first|stall_prev|stall_next|stall_last)$/;

if (stallPattern.test(customId)) {
  try {
    // Safety defer (update style)
    await autoDefer(interaction, 'update');

    // ✅ NEW — extracts from title like "Stall Preview – Page 1/5"
    const match = interaction.message.embeds?.[0]?.title?.match(/Page (\d+)\/(\d+)/);
    if (!match || match.length < 3) return;

    let [ , currentPage, totalPages ] = match.map(Number);
    if (customId === 'stall_first') currentPage = 1;
    if (customId === 'stall_prev') currentPage = Math.max(1, currentPage - 1);
    if (customId === 'stall_next') currentPage = Math.min(totalPages, currentPage + 1);
    if (customId === 'stall_last') currentPage = totalPages;

    const updatedEmbed = JSON.parse(JSON.stringify(interaction.message.embeds[0]));
    updatedEmbed.title = `Stall Page ${currentPage}/${totalPages}`;
    updatedEmbed.description = `This is stall page ${currentPage}.`;

    // Safe update after deferring
    await interaction.editReply({ embeds: [updatedEmbed] });

  } catch (err) {
    console.error('Failed to update stall navigation:', err);
  }

  return;
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
    }

    if (customId.startsWith('rehearsal')) {

try {
  // Prefer interaction.message if available (works for buttons)
  message = interaction.message || await interaction.fetchReply();
} catch (err) {
  console.warn('⚠️ Failed to fetch message:', err.message);
  return safeReply(interaction, {
    content: '⚠️ This interaction has expired or can’t be accessed.',
    flags: 1 << 6
  });
}

if (!message) {
  return safeReply(interaction, {
    content: '❌ Could not find the message for this interaction.',
    flags: 1 << 6
  });
}

// Ensure only the original user interacts
if (message.interaction?.user?.id && interaction.user.id !== message.interaction.user.id) {
  return safeReply(interaction, {
    content: 'These buttons are not yours.',
    flags: 1 << 6
  });
}
await autoDefer(interaction, 'update');
  const index = parseInt(interaction.customId.split('_')[1], 10);
  const userId = interaction.user.id;

  // await interaction.deferUpdate().catch(() => {});

    // Pull 3 random cards just like in the original command
    const { EmbedBuilder } = require('discord.js');
const UserInventory = require('../models/UserInventory');
const UserRecord = require('../models/UserRecord');
const giveCurrency = require('../utils/giveCurrency');

const cards = interaction.client.cache?.rehearsal?.[userId];
if (!cards || cards.length < 3) {
  return safeReply(interaction, { content: 'Rehearsal session not found or expired.', flags: 1 << 6 });
}

const selected = cards[index];
const sopop = Math.random() < 0.32 ? (Math.random() < 0.75 ? 1 : 2) : 0;
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

// 🔁 Use local image attachment if available
let imageSource = selected.localImagePath
  ? `attachment://${selected._id || 'preview'}.png`
  : selected.discordPermalinkImage || selected.imgurImageLink;

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
  .setImage(imageSource)
  .setColor('#FFD700');

// 🧷 File attachment if needed
const imageAttachment = selected.localImagePath
  ? new AttachmentBuilder(selected.localImagePath, { name: `${selected._id || 'preview'}.png` })
  : null;

await interaction.editReply({
  embeds: [resultEmbed],
  components: [],
  files: imageAttachment ? [imageAttachment] : []
  });

  if (interaction.deferred || interaction.replied) {
  try {
    await interaction.editReply({ components: [] });
  } catch (err) {
    console.warn('editReply failed:', err.message);
  }
}
}

const showcasePattern = /^(show_first|show_prev|show_next|show_last)$/;
if (showcasePattern.test(customId)) {
  const userId = interaction.user.id;
  const showcasePages = interaction.client.cache?.showcase?.[userId];

  if (!showcasePages?.length) {
    return interaction.update({
      content: '❌ Showcase session expired or not found.',
      embeds: [],
      components: []
    });
  }

  const currentEmbed = interaction.message.embeds[0];
  let current = showcasePages.findIndex(p =>
    p.embed?.data?.title === currentEmbed.title &&
    p.embed?.data?.description === currentEmbed.description
  );
  if (current === -1) current = 0;

  if (customId === 'show_first') current = 0;
  else if (customId === 'show_prev') current = (current - 1 + showcasePages.length) % showcasePages.length;
  else if (customId === 'show_next') current = (current + 1) % showcasePages.length;
  else if (customId === 'show_last') current = showcasePages.length - 1;

  const page = showcasePages[current];

  return interaction.update({
    embeds: [page.embed],
    components: [interaction.message.components[0]],
    files: page.attachment ? [page.attachment] : []
  });
}

};