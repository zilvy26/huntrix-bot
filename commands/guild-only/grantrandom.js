const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const Card = require('../../models/Card');
const safeReply = require('../../utils/safeReply');
const UserInventory = require('../../models/UserInventory');
const UserRecord = require('../../models/UserRecord');
const generateStars = require('../../utils/starGenerator');
const awaitUserButton = require('../../utils/awaitUserButton');
const GRANTING_ROLE_ID = process.env.GRANTING_ROLE_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grantrandom')
    .setDescription('Grant random cards with filters and limits')
    .setDefaultMemberPermissions('0')
    .addUserOption(o => o.setName('user').setDescription('Recipient').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Number of cards to grant').setRequired(true))
    .addStringOption(o => o.setName('groups').setDescription('Comma-separated group names'))
    .addStringOption(o => o.setName('names').setDescription('Comma-separated idol names'))
    .addStringOption(o => o.setName('eras').setDescription('Comma-separated eras'))
    .addStringOption(o => o.setName('rarities').setDescription('Rarity range, e.g. "2-5"'))
    .addIntegerOption(o => o.setName('maxstars').setDescription('Maximum total star value (optional)')),

  async execute(interaction) {
    const sender = interaction.member;
if (!sender.roles.cache.has(GRANTING_ROLE_ID)) {
  return safeReply(interaction, { content: 'You lack permission to use this.' });
}

    const recipient = interaction.options.getUser('user');
    const groups = interaction.options.getString('groups')?.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) || [];
    const names = interaction.options.getString('names')?.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) || [];
    const eras = interaction.options.getString('eras')?.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) || [];
    const rarityRange = interaction.options.getString('rarities') || '';
    const amount = interaction.options.getInteger('amount');
    const maxStars = interaction.options.getInteger('maxstars') ?? Infinity;

    if (!recipient || recipient.bot) {
      return safeReply(interaction, '❌ Invalid recipient.');
    }

    // Parse rarities range
    let minR = 0, maxR = 999;
    if (rarityRange.includes('-')) {
      const [a, b] = rarityRange.split('-').map(Number);
      if (!isNaN(a) && !isNaN(b)) [minR, maxR] = [a, b].sort((x, y) => x - y);
    } else if (rarityRange) {
      const r = Number(rarityRange);
      if (!isNaN(r)) minR = maxR = r;
    }
    // Fetch and filter cards
    const allCards = await Card.find({
      rarity: { $gte: minR, $lte: maxR }
    });
    const pool = allCards.filter(c => {
      if (groups.length && !groups.includes(c.group?.toLowerCase())) return false;
      if (names.length && !names.includes(c.name?.toLowerCase())) return false;
      if (eras.length && !eras.includes(c.era?.toLowerCase())) return false;
      return true;
    });

    if (pool.length === 0) {
      return safeReply(interaction, 'No cards match those filters.');
    }

    // Prepare recipient inventory
    let recInv = await UserInventory.findOne({ userId: recipient.id });
    if (!recInv) recInv = await UserInventory.create({ userId: recipient.id, cards: [] });

    // Grant random cards up to amount or stars
    const granted = [];
    let giftedStars = 0, totalCards = 0;
    const poolCopy = Array.from(pool);

    for (let i = 0; i < amount; i++) {
      if (poolCopy.length === 0) break;
      const card = poolCopy[Math.floor(Math.random() * poolCopy.length)];

      if (giftedStars + card.rarity > maxStars) continue;

      // Add to inventory
      let entry = recInv.cards.find(e => e.cardCode === card.cardCode);
      if (entry) entry.quantity++;
      else recInv.cards.push({ cardCode: card.cardCode, quantity: 1 });

      giftedStars += card.rarity;
      totalCards++;
      const newQty = recInv.cards.find(e => e.cardCode === card.cardCode).quantity;
      granted.push({ card, qty: 1, total: newQty });

      await UserRecord.create({
        userId: recipient.id,
        type: 'grantrandom',
        targetId: interaction.user.id,
        detail: `Received random ${card.name} (${card.cardCode}) [${card.rarity}] from <@${interaction.user.id}>`
      });
    }

    await recInv.save();

    if (!granted.length) {
      return safeReply(interaction, 'No cards could be granted under the star/amount limits.');
    }

    // Build paginated embed and buttons
    let current = 0;
    const perPage = 5;
    const pages = Math.ceil(granted.length / perPage);
    const grouped = {};
for (const item of granted) {
  const code = item.card.cardCode;
  const qty = item.qty;

  if (!grouped[code]) {
    grouped[code] = {
      ...item,
      qty,
      total: item.total // make sure this value was updated correctly when cards were granted
    };
  } else {
    grouped[code].qty += qty;
    grouped[code].total += qty; // ✨ UPDATE TOTAL INVENTORY
  }
}

// Then paginate from grouped items
const groupedItems = Object.values(grouped);
const totalPages = Math.ceil(groupedItems.length / perPage);

    const renderEmbed = idx => {
const pageItems = groupedItems.slice(idx * perPage, (idx + 1) * perPage);

const desc = pageItems.map(g =>
  `• ${generateStars({ rarity: g.card.rarity, overrideEmoji: g.card.emoji })} \`${g.card.cardCode}\` — **x${g.qty}** — [Copies: ${g.total}]`
).join('\n') || 'No cards granted.';

      return new EmbedBuilder()
        .setTitle(`Random Cards Given to ${recipient.username}`)
        .setColor('#2f3136')
        .setDescription(desc)
        .addFields(
          { name: 'Total Cards', value: `${totalCards}`, inline: true },
          { name: 'Total <:fullstar:1387609456824680528>', value: `${giftedStars}`, inline: true }
        )
        .setFooter({ text: `Page ${idx + 1} of ${totalPages}` });
    };

    const renderRow = () => new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary).setDisabled(current === 0).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
              new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary).setDisabled(current === 0).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
              new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary).setDisabled(current >= totalPages - 1).setEmoji({ id: '1390462706544410704', name: ':ehx_rightarrow' }),
              new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary).setDisabled(current >= totalPages - 1).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
            );
        
            await safeReply(interaction, { embeds: [renderEmbed(current)], components: [renderRow()] });
        
            while (true) {
              const btn = await awaitUserButton(interaction, interaction.user.id, ['first', 'prev', 'next', 'last'], 120000);
              if (!btn) break;
        
              if (btn.customId === 'first') current = 0;
              if (btn.customId === 'prev') current = Math.max(0, current - 1);
              if (btn.customId === 'next') current = Math.min(totalPages - 1, current + 1);
              if (btn.customId === 'last') current = totalPages - 1;
        
              await safeReply(interaction, { embeds: [renderEmbed(current)], components: [renderRow()] });
            }
        
            // Final cleanup
            try {
              await safeReply(interaction, { components: [] });
            } catch (err) {
              console.warn('Pagination cleanup failed:', err.message);
            }
          }
        };