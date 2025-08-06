const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const Card = require('../../models/Card');
const UserInventory = require('../../models/UserInventory');
const generateStars = require('../../utils/starGenerator');
const awaitUserButton = require('../../utils/awaitUserButton');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('index')
    .setDescription('View your inventory with filters and pagination.')
    .addStringOption(opt =>
      opt.setName('show')
        .setDescription('Which cards to show')
        .setRequired(true)
        .addChoices(
          { name: 'Owned Only', value: 'owned' },
          { name: 'Missing Only', value: 'missing' },
          { name: 'Duplicates Only', value: 'dupes' },
          { name: 'All', value: 'all' }
        )
    )
    .addUserOption(opt => opt.setName('user').setDescription('Whose inventory to view?'))
    .addStringOption(opt => opt.setName('group').setDescription('Filter by group'))
    .addStringOption(opt => opt.setName('era').setDescription('Filter by era'))
    .addStringOption(opt => opt.setName('name').setDescription('Filter by card name'))
    .addStringOption(opt => opt.setName('rarity').setDescription('Filter by rarity'))
    .addStringOption(opt =>
  opt.setName('include_customs')
    .setDescription('Show Customs, Test & Limited cards?')
    .addChoices(
      { name: 'Yes', value: 'yes' },
      { name: 'No', value: 'no' }
    )
),

  async execute(interaction) {
    await interaction.deferReply();

    const user = interaction.options.getUser('user') || interaction.user;
    const parseList = (input) =>
  input?.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) || [];

const filters = {
  groups: parseList(interaction.options.getString('group')),
  eras: parseList(interaction.options.getString('era')),
  names: parseList(interaction.options.getString('name')),
  rarities: parseList(interaction.options.getString('rarity')),
  show: interaction.options.getString('show') || 'owned',
  includeCustoms: interaction.options.getString('include_customs') === 'yes'
};

const allCards = await Card.find().lean();
const inv = await UserInventory.findOne({ userId: user.id });
const inventoryMap = new Map();
if (inv) {
  for (const entry of inv.cards) {
    inventoryMap.set(entry.cardCode, entry.quantity);
  }
}

    const cardList = allCards.filter(card => {
  const inInv = inventoryMap.has(card.cardCode);
  const copies = inventoryMap.get(card.cardCode) || 0;

  const groupMatch = !filters.groups.length || filters.groups.includes(card.group.toLowerCase());
  const eraMatch = !filters.eras.length || filters.eras.includes((card.era || '').toLowerCase());
  const nameMatch = !filters.names.length || filters.names.includes(card.name.toLowerCase());
  const rarityMatch = !filters.rarities.length || filters.rarities.includes(String(card.rarity));

  // ❌ Skip unwanted groups unless toggled on
  if (!filters.includeCustoms && ['customs', 'test', 'limited'].includes(card.group.toLowerCase())) return false;

  if (!(groupMatch && eraMatch && nameMatch && rarityMatch)) return false;

  if (filters.show === 'owned') return inInv && copies > 0;
  if (filters.show === 'missing') return !inInv;
  if (filters.show === 'dupes') return inInv && copies > 1;

  return true;
});
    cardList.sort((a, b) => parseInt(b.rarity) - parseInt(a.rarity));

    if (!cardList.length) {
      return interaction.editReply({ content: 'No cards match your filters.' });
    }

    let totalCopies = 0;
    let totalStars = 0;

if (filters.show === 'dupes') {
  for (const card of cardList) {
    const qty = inventoryMap.get(card.cardCode) || 0;
    if (qty > 1) {
      totalCopies += qty - 1;
      totalStars += card.rarity * (qty - 1);
    }
  }
} else {
  totalCopies = cardList.reduce((acc, card) => acc + (inventoryMap.get(card.cardCode) || 0), 0);
  totalStars = cardList.reduce((acc, card) => acc + (card.rarity * (inventoryMap.get(card.cardCode) || 0)), 0);
}

    const perPage = 6;
    const totalPages = Math.ceil(cardList.length / perPage);
    let page = 0;

    const makeEmbed = (pg) => {
      const slice = cardList.slice(pg * perPage, pg * perPage + perPage);
      const description = slice.map(card => {
        const copies = inventoryMap.get(card.cardCode) || 0;
        const stars = generateStars({ rarity: card.rarity, overrideEmoji: card.emoji });
        return `**${stars} ${card.name}**\nGroup: ${card.group}${card.category?.toLowerCase() === 'kpop' && card.era ? ` | Era: ${card.era}` : ''} | Code: \`${card.cardCode}\` | Copies: ${copies}`;
      }).join('\n\n');

      return new EmbedBuilder()
        .setTitle(`${user.username}'s Inventory`)
        .setDescription(description)
        .setColor('#FF69B4')
        .setFooter({
          text: `Page ${pg + 1} of ${totalPages} • Total Cards: ${cardList.length} • Total Copies: ${totalCopies} • Total Stars: ${totalStars}`
        });
    };

    const makeRow = () => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary).setDisabled(page === 0).setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary).setDisabled(page === 0).setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1).setEmoji({ id: '1390462706544410704', name: ':ehx_rightarrow' }),
      new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1).setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
      new ButtonBuilder().setCustomId('copy').setLabel('Copy Codes').setStyle(ButtonStyle.Success)
    );

    await interaction.editReply({ embeds: [makeEmbed(page)], components: [makeRow()] });

    while (true) {
  let btn;

  try {
    btn = await awaitUserButton(interaction, interaction.user.id, ['first', 'prev', 'next', 'last', 'copy'], 120000);
    if (!btn) break;
  } catch (err) {
    console.warn('Button collector expired or failed:', err.message);
    break;
  }

  try {
    // Set page state for navigation
    if (btn.customId === 'first') page = 0;
    else if (btn.customId === 'prev') page = Math.max(page - 1, 0);
    else if (btn.customId === 'next') page = Math.min(page + 1, totalPages - 1);
    else if (btn.customId === 'last') page = totalPages - 1;
    else if (btn.customId === 'copy') {
  const slice = cardList.slice(page * perPage, page * perPage + perPage);
  const codes = slice.map(c => c.cardCode).join(', ');

  try {
    if (!btn.replied && !btn.deferred) {
      await btn.reply({
        content: `\n\`\`\`${codes}\`\`\``,
        flags: 1 << 6
      });
    } else {
      // fallback: edit reply if already replied or deferred
      await btn.followUp({
        content: `\n\`\`\`${codes}\`\`\``,
        flags: 1 << 6
      });
    }
  } catch (err) {
    console.warn('Failed to send code reply:', err.message);
  }

  continue; // Don't fall through to editReply
}

// Only defer/update for other buttons
if (!btn.replied && !btn.deferred) {
  await btn.deferUpdate(); // ✅ allows .update() to safely run
}

await btn.editReply({
  embeds: [makeEmbed(page)],
  components: [makeRow()],
});
  } catch (err) {
    console.error('Failed to update message:', err.message);
    break;
  }
}

try {
  if (interaction.replied || interaction.deferred) {
    await interaction.editReply({ components: [] });
  }
} catch (err) {
  if (err.message !== 'Unknown Message') {
    console.warn('🔧 Failed to clean up buttons:', err.message);
  }
}
  }
};