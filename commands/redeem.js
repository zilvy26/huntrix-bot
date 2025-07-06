const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const RedeemCode = require('../models/RedeemCode');
const Card = require('../models/Card');
const User = require('../models/User');
const UserInventory = require('../models/UserInventory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Redeem a code for rewards!')
    .addStringOption(opt =>
      opt.setName('code')
        .setDescription('Your redeem code')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('cardcode')
        .setDescription('(Optional) Choose a card code if allowed')),

  async execute(interaction) {
    const userId = interaction.user.id;
    const codeInput = interaction.options.getString('code').trim().toUpperCase();
    const selectedCardInput = interaction.options.getString('cardcode')?.trim().toUpperCase();

    const code = await RedeemCode.findOne({ code: codeInput });
    if (!code) return interaction.reply({ content: '❌ Invalid code.' });
    if (code.expiresAt && code.expiresAt < new Date()) return interaction.reply({ content: '⏳ This code has expired.' });
    if (code.maxUses && code.usedBy.length >= code.maxUses) return interaction.reply({ content: '⚠️ This code has reached its usage limit.' });
    if (code.usedBy.includes(userId)) return interaction.reply({ content: '⚠️ You already used this code.' });

    // Currency reward
    if (code.reward && (code.reward.patterns || code.reward.sopop)) {
      await User.findOneAndUpdate(
        { userId },
        {
          $inc: {
            patterns: code.reward.patterns || 0,
            sopop: code.reward.sopop || 0
          }
        },
        { upsert: true }
      );
    }

    // Static card reward
    if (code.cardCode) {
      const cardCode = code.cardCode;
      const inv = await UserInventory.findOneAndUpdate(
        { userId },
        { $inc: { 'cards.$[el].quantity': 1 } },
        { arrayFilters: [{ 'el.cardCode': cardCode }], new: true }
      );
      if (!inv || !inv.cards.some(c => c.cardCode === cardCode)) {
        await UserInventory.findOneAndUpdate(
          { userId },
          { $push: { cards: { cardCode, quantity: 1 } } },
          { upsert: true }
        );
      }
    }
    // Track usage
    code.usedBy.push(userId);
    await code.save();

    // If card choice is allowed
    if (code.allowCardChoice) {
      if (selectedCardInput) {
        const validCard = await Card.findOne({ cardCode: selectedCardInput, category: { $ne: 'others' } });
        if (!validCard) {
          return interaction.reply({ content: '❌ Invalid card code or card is in the "others" category.' });
        }

        const inv = await UserInventory.findOneAndUpdate(
          { userId },
          { $inc: { 'cards.$[el].quantity': 1 } },
          { arrayFilters: [{ 'el.cardCode': selectedCardInput }], new: true }
        );
        if (!inv || !inv.cards.some(c => c.cardCode === selectedCardInput)) {
          await UserInventory.findOneAndUpdate(
            { userId },
            { $push: { cards: { cardCode: selectedCardInput, quantity: 1 } } },
            { upsert: true }
          );
        }

        return interaction.reply({ content: `✅ Redeemed and received card **${selectedCardInput}**!` });
      }

      // Fallback to dropdown
      const cards = await Card.find({ category: { $ne: 'others' } }).lean();
      const options = cards.slice(0, 25).map(card => ({
        label: card.name.slice(0, 100),
        value: card.cardCode
      }));

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('choose_card')
          .setPlaceholder('Pick a card to redeem')
          .addOptions(options)
      );

      const reply = await interaction.reply({
        content: '🎴 Pick one card from the list:',
        components: [row],
        
      });

      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 15000,
        max: 1
      });

      collector.on('collect', async i => {
        const selectedCard = i.values[0];
        const inv = await UserInventory.findOneAndUpdate(
          { userId },
          { $inc: { 'cards.$[el].quantity': 1 } },
          { arrayFilters: [{ 'el.cardCode': selectedCard }], new: true }
        );
        if (!inv || !inv.cards.some(c => c.cardCode === selectedCard)) {
          await UserInventory.findOneAndUpdate(
            { userId },
            { $push: { cards: { cardCode: selectedCard, quantity: 1 } } },
            { upsert: true }
          );
        }
        await i.update({ content: `✅ You received card **${selectedCard}**!`, components: [] });
      });

      collector.on('end', async (_, reason) => {
        if (reason === 'time') {
          await interaction.editReply({ content: '⏰ Selection expired.', components: [] });
        }
      });

      return;
    }

    // Final fallback
    const summary = [
      `🎉 Redeemed **${code.code}**!`,
      code.reward?.patterns ? `• 🪙 ${code.reward.patterns} Patterns` : null,
      code.reward?.sopop ? `• 💎 ${code.reward.sopop} Sopop` : null,
      code.cardCode ? `• 📦 Card Code: ${code.cardCode}` : null
    ].filter(Boolean).join('\n');

    return interaction.reply({ content: summary });
  }
};