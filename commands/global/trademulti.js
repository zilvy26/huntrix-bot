// commands/global/trademulti.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const Card = require('../../models/Card');
const InventoryItem = require('../../models/InventoryItem'); // ✅ NEW
const UserRecord = require('../../models/UserRecord');
const generateStars = require('../../utils/starGenerator');
const awaitUserButton = require('../../utils/awaitUserButton');
const { safeReply } = require('../../utils/safeReply');

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
    .addStringOption(opt =>
      opt.setName('rarityrange')
        .setDescription('Rarity range like 3 or 2-5')
        .setRequired(true))
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
    const giver = interaction.user;
    const target = interaction.options.getUser('user');
    if (target.bot || target.id === giver.id) {
      return safeReply(interaction, 'You can’t gift cards to yourself or bots.');
    }

    // --- Parse filters (case-insensitive exact match)
    const parseCsv = (s) => (s || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
    const filters = {
      group: parseCsv(interaction.options.getString('group')),
      name: parseCsv(interaction.options.getString('name')),
      era: parseCsv(interaction.options.getString('era')),
      exclude_group: parseCsv(interaction.options.getString('exclude_group')),
      exclude_name: parseCsv(interaction.options.getString('exclude_name')),
      exclude_era: parseCsv(interaction.options.getString('exclude_era')),
    };
    const mode = interaction.options.getString('mode'); // 'all' | 'duplicates'
    const maxStars = interaction.options.getInteger('maxstars') ?? Infinity;

    // --- Rarity parser
    const rarityRangeRaw = interaction.options.getString('rarityrange');
    let minRarity = 1, maxRarity = 5;
    if (rarityRangeRaw) {
      const matchRange = rarityRangeRaw.match(/^(\d+)-(\d+)$/);
      const matchSingle = rarityRangeRaw.match(/^(\d+)$/);
      if (matchRange) {
        minRarity = Math.max(1, Math.min(5, parseInt(matchRange[1], 10)));
        maxRarity = Math.max(1, Math.min(5, parseInt(matchRange[2], 10)));
        if (minRarity > maxRarity) [minRarity, maxRarity] = [maxRarity, minRarity];
      } else if (matchSingle) {
        minRarity = maxRarity = Math.max(1, Math.min(5, parseInt(matchSingle[1], 10)));
      } else {
        return safeReply(interaction, { content: 'Invalid rarity format. Use `3` or `2-5`.' });
      }
    }

    // --- Load giver inventory (per-item rows) and matching cards
    const giverItems = await InventoryItem.find(
      { userId: giver.id },
      { _id: 0, cardCode: 1, quantity: 1 }
    ).lean();

    if (!giverItems.length) {
      return safeReply(interaction, 'You have no cards to gift.');
    }

    const ownedCodes = giverItems.map(i => i.cardCode);
    const cardDocs = await Card.find({ cardCode: { $in: ownedCodes } }).lean();
    const cardByCode = new Map(cardDocs.map(c => [c.cardCode, c]));
    const owned = giverItems
      .map(row => ({ card: cardByCode.get(row.cardCode), qty: row.quantity }))
      .filter(x => !!x.card);

    // --- Apply filters
    const matches = owned.filter(o => {
      const c = o.card;
      const group = (c.group || '').toLowerCase();
      const name  = (c.name  || '').toLowerCase();
      const era   = (c.era   || '').toLowerCase();

      if (filters.group.length && !filters.group.includes(group)) return false;
      if (filters.name.length  && !filters.name.includes(name))   return false;
      if (filters.era.length   && !filters.era.includes(era))     return false;

      if (filters.exclude_group.length && filters.exclude_group.includes(group)) return false;
      if (filters.exclude_name.length  && filters.exclude_name.includes(name))   return false;
      if (filters.exclude_era.length   && filters.exclude_era.includes(era))     return false;

      if (c.rarity < minRarity || c.rarity > maxRarity) return false;
      return true;
    });

    if (!matches.length) {
      return safeReply(interaction, 'No matching cards found in your inventory.');
    }

    // --- Decide quantities to gift (respect mode + maxStars)
    const gifts = []; // { card, qty }
    let giftedStars = 0;
    for (const o of matches) {
      const maxQty = mode === 'duplicates' ? Math.max(0, o.qty - 1) : o.qty;
      if (maxQty <= 0) continue;

      let give = 0;
      // greedy by encounter order (your original logic)
      for (let i = 0; i < maxQty; i++) {
        const nextStars = giftedStars + (o.card.rarity || 0);
        if (nextStars > maxStars) break;
        giftedStars = nextStars;
        give++;
      }
      if (give > 0) gifts.push({ card: o.card, qty: give });
    }

    if (!gifts.length) {
      return safeReply(interaction, 'No cards available to gift under this mode.');
    }

    // --- Perform the trade (per code: dec giver with guard; inc receiver)
    let totalCards = 0;
    let totalSouls = 0;
    const gifted = []; // { card, qty, total }
    for (const g of gifts) {
      const code = g.card.cardCode;

      // 1) Decrement giver with guard (prevents negatives)
      const dec = await InventoryItem.findOneAndUpdate(
        { userId: giver.id, cardCode: code, quantity: { $gte: g.qty } },
        { $inc: { quantity: -g.qty } },
        { new: true, projection: { quantity: 1 } }
      );
      if (!dec) {
        // Not enough copies (race or mismatch) → skip this card
        continue;
      }
      if ((dec.quantity ?? 0) <= 0) {
        await InventoryItem.deleteOne({ userId: giver.id, cardCode: code });
      }

      // 2) Increment receiver (upsert)
      const inc = await InventoryItem.findOneAndUpdate(
        { userId: target.id, cardCode: code },
        { $setOnInsert: { userId: target.id, cardCode: code }, $inc: { quantity: g.qty } },
        { upsert: true, new: true, projection: { quantity: 1, _id: 0 } }
      );
      const newQty = inc?.quantity ?? g.qty;

      // 3) Audit logs (one per copy like your original)
      for (let i = 0; i < g.qty; i++) {
        await UserRecord.create({
          userId: target.id,
          type: 'trademulti',
          targetId: giver.id,
          detail: `Received ${g.card.name} (${g.card.cardCode}) [${g.card.rarity}] from <@${giver.id}>`
        });
        await UserRecord.create({
          userId: giver.id,
          type: 'trademulti',
          targetId: target.id,
          detail: `Gave ${g.card.name} (${g.card.cardCode}) [${g.card.rarity}] to <@${target.id}>`
        });
      }

      gifted.push({ card: g.card, qty: g.qty, total: newQty });
      totalCards += g.qty;
      totalSouls += g.qty * (g.card.rarity || 0);
    }

    if (!gifted.length) {
      return safeReply(interaction, 'No cards were successfully gifted (not enough copies?).');
    }

    // --- Pagination embed
    const perPage = 5;
    const pages = Math.ceil(gifted.length / perPage);
    let current = 0;

    const renderEmbed = (page) => {
      const slice = gifted.slice(page * perPage, (page + 1) * perPage);
      const desc = slice.map(g =>
        `• ${generateStars({ rarity: g.card.rarity, overrideEmoji: g.card.emoji })} \`${g.card.cardCode}\` — **x${g.qty}** [Copies: ${g.total}]`
      ).join('\n');

      return new EmbedBuilder()
        .setTitle(`Cards Traded to ${target.username}`)
        .setColor('#2f3136')
        .setDescription(desc || 'Nothing to show.')
        .addFields(
          { name: 'Total Cards', value: `${totalCards}`, inline: true },
          { name: 'Total <:fullstar:1387609456824680528>', value: `${giftedStars}`, inline: true }
        )
        .setFooter({ text: `Page ${page + 1} of ${pages}` });
    };

    const renderRow = () => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('first').setStyle(ButtonStyle.Secondary)
        .setDisabled(current === 0)
        .setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new ButtonBuilder().setCustomId('prev').setStyle(ButtonStyle.Primary)
        .setDisabled(current === 0)
        .setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new ButtonBuilder().setCustomId('next').setStyle(ButtonStyle.Primary)
        .setDisabled(current >= pages - 1)
        .setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }),
      new ButtonBuilder().setCustomId('last').setStyle(ButtonStyle.Secondary)
        .setDisabled(current >= pages - 1)
        .setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
    );

    // Send summary
    await safeReply(interaction, { embeds: [renderEmbed(current)], components: [renderRow()] });

    // Ping recipient in a separate message (so it hits Mentions)
    await interaction.followUp({
      content: `Multitrade sent to <@${target.id}>!`,
      allowedMentions: { users: [target.id] }
    });

    // Pagination loop
    while (true) {
      const btn = await awaitUserButton(interaction, interaction.user.id, ['first', 'prev', 'next', 'last'], 120000);
      if (!btn) break;

      if (!btn.deferred && !btn.replied) {
        try { await btn.deferUpdate(); } catch {}
      }

      if (btn.customId === 'first') current = 0;
      else if (btn.customId === 'prev') current = Math.max(0, current - 1);
      else if (btn.customId === 'next') current = Math.min(pages - 1, current + 1);
      else if (btn.customId === 'last') current = pages - 1;

      await interaction.editReply({ embeds: [renderEmbed(current)], components: [renderRow()] });
    }

    // Cleanup
    try { await interaction.editReply({ components: [] }); } catch (err) {
      console.warn('Pagination cleanup failed:', err.message);
    }
  }
};
