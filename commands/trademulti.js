const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const Card = require('../models/Card');
const UserInventory = require('../models/UserInventory');
const UserRecord = require('../models/UserRecord');
const generateStars = require('../utils/starGenerator');
const awaitUserButton = require('../utils/awaitUserButton');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trademulti')
    .setDescription('Gift multiple cards using filters')
    .addUserOption(o => o.setName('user').setDescription('Recipient').setRequired(true))
    .addStringOption(o => 
      o.setName('mode')
       .setDescription('Select gift mode')
       .setRequired(true)
       .addChoices(
         { name: 'All copies', value: 'all' },
         { name: 'Duplicates only', value: 'duplicates' }
       ))
    .addStringOption(o => o.setName('group').setDescription('Filter by group(s), comma-separated'))
.addStringOption(o => o.setName('name').setDescription('Filter by name(s), comma-separated'))
.addStringOption(o => o.setName('era').setDescription('Filter by era(s), comma-separated'))
.addStringOption(o => o.setName('exclude_group').setDescription('Exclude these group(s), comma-separated'))
.addStringOption(o => o.setName('exclude_name').setDescription('Exclude these name(s), comma-separated'))
.addStringOption(o => o.setName('exclude_era').setDescription('Exclude these era(s), comma-separated'))
    .addIntegerOption(opt =>
  opt.setName('maxstars')
    .setDescription('Max total rarity (Stars) allowed to be gifted')
    .setRequired(false)
),

  async execute(interaction) {
    await interaction.deferReply();

    const giver = interaction.user;
    const target = interaction.options.getUser('user');
    const filters = {
  group: interaction.options.getString('group')?.toLowerCase().split(',').map(x => x.trim()) || [],
  name: interaction.options.getString('name')?.toLowerCase().split(',').map(x => x.trim()) || [],
  era: interaction.options.getString('era')?.toLowerCase().split(',').map(x => x.trim()) || [],
  exclude_group: interaction.options.getString('exclude_group')?.toLowerCase().split(',').map(x => x.trim()) || [],
  exclude_name: interaction.options.getString('exclude_name')?.toLowerCase().split(',').map(x => x.trim()) || [],
  exclude_era: interaction.options.getString('exclude_era')?.toLowerCase().split(',').map(x => x.trim()) || []
};
    const mode = interaction.options.getString('mode');
    const maxStars = interaction.options.getInteger('maxstars') ?? Infinity;

    if (target.id === giver.id) {
      return interaction.editReply('❌ You can’t gift cards to yourself.');
    }
    const invDoc = await UserInventory.findOne({ userId: giver.id });
    if (!invDoc || !invDoc.cards.length) {
      return interaction.editReply('❌ You have no cards to gift.');
    }

    // Prepare filtered list
    const owned = await Promise.all(
      invDoc.cards.map(async c => ({
        card: await Card.findOne({ cardCode: c.cardCode }),
        qty: c.quantity
      }))
    );

    const matches = owned.filter(o => {
  const card = o.card;
  if (!card) return false;

  const group = card.group.toLowerCase();
  const name = card.name.toLowerCase();
  const era = (card.era || '').toLowerCase();

  if (filters.group.length && !filters.group.includes(group)) return false;
  if (filters.name.length && !filters.name.some(n => name.includes(n))) return false;
  if (filters.era.length && !filters.era.includes(era)) return false;

  if (filters.exclude_group.length && filters.exclude_group.includes(group)) return false;
  if (filters.exclude_name.length && filters.exclude_name.some(n => name.includes(n))) return false;
  if (filters.exclude_era.length && filters.exclude_era.includes(era)) return false;

  return true;
});

    if (!matches.length) {
      return interaction.editReply('❌ No matching cards found in your inventory.');
    }

    // Determine gift quantities
    const gifts = [];
let giftedStars = 0;

for (const o of matches) {
  const maxQty = mode === 'duplicates' ? Math.max(0, o.qty - 1) : o.qty;
  let qty = 0;

  for (let i = 0; i < maxQty; i++) {
    const nextStars = giftedStars + o.card.rarity;
    if (nextStars > maxStars) break;
    giftedStars += o.card.rarity;
    qty++;
  }

  if (qty > 0) {
    gifts.push({ card: o.card, qty });
  }
}

    if (!gifts.length) {
      return interaction.editReply('❌ No cards available to gift under this mode.');
    }

    // Fetch or create receiver's inventory
    let recInv = await UserInventory.findOne({ userId: target.id });
    if (!recInv) recInv = new UserInventory({ userId: target.id, cards: [] });

    let totalCards = 0;
    let totalSouls = 0;
    const gifted = [];

    for (const g of gifts) {
      const fromEntry = invDoc.cards.find(c => c.cardCode === g.card.cardCode);
      fromEntry.quantity -= g.qty;

      const toEntry = recInv.cards.find(c => c.cardCode === g.card.cardCode) ||
                      recInv.cards.find(c => { if (!c.cardCode) c.cardCode = g.card.cardCode; return false; });

      if (toEntry) toEntry.quantity += g.qty;
      else recInv.cards.push({ cardCode: g.card.cardCode, quantity: g.qty });

      totalCards += g.qty;
      totalSouls += g.qty * g.card.rarity;
      const newQty = recInv.cards.find(c => c.cardCode === g.card.cardCode).quantity;
      gifted.push({ card: g.card, qty: g.qty, total: newQty });

      // Logging
      for (let i = 0; i < g.qty; i++) {
        await UserRecord.create({
          userId: target.id,
          type: 'trademulti',
          targetId: giver.id,
          detail: `Received ${g.card.name} (${g.card.cardCode}) [${g.card.rarity}] from <@${interaction.user.id}>`
        });
      }
    }

    await invDoc.save();
    await recInv.save();

    const perPage = 5;
    const pages = Math.ceil(gifted.length / perPage);
    let current = 0;

    const renderEmbed = (page) => {
      const slice = gifted.slice(page * perPage, (page + 1) * perPage);
      const desc = slice.map(g =>
        `• ${generateStars({ rarity: g.card.rarity })} \`${g.card.cardCode}\` — **x${g.qty}** [Copies: ${g.total}]`
      ).join('\n');

      return new EmbedBuilder()
        .setTitle(`Cards Traded to ${target.username}`)
        .setColor('#2f3136')
        .setDescription(desc)
        .addFields(
          { name: 'Total Cards', value: `${totalCards}`, inline: true },
          { name: 'Total <:fullstar:1387609456824680528>', value: `${giftedStars}`, inline: true }
        )
        .setFooter({ text: `Page ${page + 1} of ${pages}` });
    };

     const renderRow = () => new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('first').setLabel('⏮ First').setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
          new ButtonBuilder().setCustomId('prev').setLabel('◀ Back').setStyle(ButtonStyle.Primary).setDisabled(current === 0),
          new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(current >= pages - 1),
          new ButtonBuilder().setCustomId('last').setLabel('Last ⏭').setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1)
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