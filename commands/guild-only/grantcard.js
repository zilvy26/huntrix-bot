const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const dotenv = require('dotenv');
dotenv.config();

const Card = require('../../models/Card');
const UserInventory = require('../../models/UserInventory');
const UserRecord = require('../../models/UserRecord');
const generateStars = require('../../utils/starGenerator');
const awaitUserButton = require('../../utils/awaitUserButton');

const GRANTING_ROLE_ID = process.env.GRANTING_ROLE_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grantcard')
    .setDescription('Grant one or more cards to a user by card code')
    .setDefaultMemberPermissions('0')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('User to receive the cards')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('cardcodes')
        .setDescription('Comma-separated card codes (e.g. CODE1x2, CODE2)')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();

    const sender = interaction.member;
    const targetUser = interaction.options.getUser('user');
    const rawCodes = interaction.options.getString('cardcodes');

    if (!sender.roles.cache.has(GRANTING_ROLE_ID)) {
      return interaction.editReply({ content: 'You lack permission to use this.' });
    }

    // Count quantity per code
    const counts = {};
    const parts = rawCodes.split(',').map(c => c.trim()).filter(Boolean);

    for (const part of parts) {
      const match = part.match(/^([A-Z0-9\-]+?)(?:X(\d+))?$/i);
      if (!match) continue;
      const code = match[1].toUpperCase(); // force uppercase
      const qty = parseInt(match[2] || '1');
      if (!counts[code]) counts[code] = 0;
      counts[code] += qty;
    }

    const uniqueCodes = Object.keys(counts);
    

    const cards = await Card.find({ cardCode: { $in: uniqueCodes } });

    if (!cards.length) {
      return interaction.editReply({ content: 'No valid cards found for those codes.' });
    }

    let inv = await UserInventory.findOne({ userId: targetUser.id });
    if (!inv) inv = await UserInventory.create({ userId: targetUser.id, cards: [] });
    const granted = [];
    let totalSouls = 0;
    let totalCards = 0;

    for (const card of cards) {
      const qty = counts[card.cardCode] || 0;
      if (qty === 0) continue;

      const existing = inv.cards.find(c => c.cardCode === card.cardCode);
      const newQty = existing ? existing.quantity + qty : qty;

      if (existing) existing.quantity = newQty;
      else inv.cards.push({ cardCode: card.cardCode, quantity: qty });

      granted.push({ card, qty, total: newQty });
      totalCards += qty;
      totalSouls += card.rarity * qty;

      for (let i = 0; i < qty; i++) {
        await UserRecord.create({
          userId: targetUser.id,
          type: 'grantcard',
          targetId: interaction.user.id,
          detail: `Granted ${card.name} (${card.cardCode}) [${card.rarity}] by <@${interaction.user.id}>`
        });
      }
    }

    await inv.save();

    // Paginated Embed
    let current = 0;
    const perPage = 5;
    const pages = Math.ceil(granted.length / perPage);

    const renderEmbed = (page) => {
      const pageItems = granted.slice(page * perPage, (page + 1) * perPage);
      const desc = pageItems.map(g =>
        `• ${generateStars({ rarity: g.card.rarity, overrideEmoji: g.card.emoji })} \`${g.card.cardCode}\` — **x${g.qty}** [Copies: ${g.total}]`
      ).join('\n') || 'No cards granted.';

      return new EmbedBuilder()
        .setTitle(`Cards Granted to ${targetUser.username}`)
        .setColor('#2f3136')
        .setDescription(desc)
        .addFields(
          { name: 'Total Cards', value: `${totalCards}`, inline: true },
          { name: 'Total <:fullstar:1387609456824680528> Given', value: `${totalSouls}`, inline: true }
        )
        .setFooter({ text: `Page ${page + 1} of ${pages}` });
    };

    const renderRow = () => new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary).setDisabled(current === 0).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
          new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary).setDisabled(current === 0).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
          new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary).setDisabled(current >= pages - 1).setEmoji({ id: '1390462706544410704', name: ':ehx_rightarrow' }),
          new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
        );
    
        await interaction.editReply({ embeds: [renderEmbed(current)], components: [renderRow()] });
    
        while (true) {
          const btn = await awaitUserButton(interaction, interaction.user.id, ['first', 'prev', 'next', 'last'], 120000);
          if (!btn) break;
    
          if (btn.customId === 'first') current = 0;
          if (btn.customId === 'prev') current = Math.max(0, current - 1);
          if (btn.customId === 'next') current = Math.min(pages - 1, current + 1);
          if (btn.customId === 'last') current = pages - 1;
    
          await interaction.editReply({ embeds: [renderEmbed(current)], components: [renderRow()] });
        }
    
        // Final cleanup
        try {
          await interaction.editReply({ components: [] });
        } catch (err) {
          console.warn('Pagination cleanup failed:', err.message);
        }
      }
    };