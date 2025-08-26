// commands/global/help.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const {safeReply} = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Learn about the bot and browse commands (paged)'),

  async execute(interaction) {
    // ---- 1) Build your pages any way you like ----
    // You can freely edit these embeds (add fields, images, etc.)
    const pages = [
      new EmbedBuilder()
        .setTitle('Huntrix — About')
        .setColor(0x2f3136)
        .setDescription([
          '• Pull cards, trade, battle, earn currency & more.',
          '• Slash commands are available in servers and DMs.',
          '• Discord Support Server - discord.gg/huntrixbot',
          '_Use the buttons below to navigate pages._'
        ].join('\n')),

      new EmbedBuilder()
        .setTitle('Getting Started')
        .setColor(0x2f3136)
        .addFields(
          { name: 'Register', value: '`/register` to create your user data.' },
          { name: 'Command Cooldowns', value: '`/cooldowns` to view your command timers.' },
          { name: 'Profile', value: '`/profile` & `/editprofile` to view or customize.' },
        ),

      new EmbedBuilder()
        .setTitle('Core Commands')
        .setColor(0x2f3136)
        .setDescription([
          '`/pull` & `/pull10` — pull cards',
          '`/rehearsal` & `/list` — select & claim cards',
          '`/tradecard` & `/trademulti` — trade with others',
          '`/pay` — give another user currency',
          '`/balance` — see your currency balance',
        ].join('\n')),

      new EmbedBuilder()
        .setTitle('Utilities Commands')
        .setColor(0x2f3136)
        .setDescription([
          '`/index` — view your card inventory & card catalog',
          '`/records` — view yours or another user’s activity logs',
          '`/showcase <codes>` — view card(s) information',
          '`/refund` — refunds card codes, groups and more for currency',
        ].join('\n')),

      new EmbedBuilder()
        .setTitle('Economy Commands')
        .setColor(0x2f3136)
        .setDescription([
          '`/perform` — earn currency for performing',
          '`/vote` — voting topgg rewards',
          '`/daily` — 24 hour rewards',
          '`/battle` — guessing questions for rewards',
        ].join('\n')),
        
      new EmbedBuilder()
        .setTitle('Stall & Shop Commands')
        .setColor(0x2f3136)
        .setDescription([
          '`/boutique view` — Huntrix Shop prices & info',
          '`/boutique cards` — Huntrix Card Shop',
          '`/boutique template` — Huntrix Profile Template Shop',
          '`/stall preview` — view Huntrix stall of cards',
          '`/stall buy` — purchase card(s) from stall',
          '`/stall sell` — list a card for sale on stall',
          '`/stall remove` — remove your card listing from stall',
        ].join('\n')),
    ];

    // ---- 2) Send first page + buttons (no collectors) ----
    const makeRow = (page, total) => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('help:first').setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0)
        .setEmoji({ id: '1390467720142651402', name: 'ehx_leftff' }),
      new ButtonBuilder().setCustomId('help:prev').setStyle(ButtonStyle.Primary)
        .setDisabled(page === 0)
        .setEmoji({ id: '1390462704422096957', name: 'ehx_leftarrow' }),
      new ButtonBuilder().setCustomId('help:next').setStyle(ButtonStyle.Primary)
        .setDisabled(page >= total - 1)
        .setEmoji({ id: '1390462706544410704', name: 'ehx_rightarrow' }), // ← no leading colon
      new ButtonBuilder().setCustomId('help:last').setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= total - 1)
        .setEmoji({ id: '1390467723049439483', name: 'ehx_rightff' }),
    );

    const total = pages.length;
    const msg = await safeReply(interaction, {
      embeds: [pages[0].setFooter({ text: `Page 1 of ${total}` })],
      components: [makeRow(0, total)]
    });

    // ---- 3) Register a short-lived session for the router ----
    interaction.client.cache ??= {};
    interaction.client.cache.help ??= {}; // keyed by messageId
    interaction.client.cache.help[msg.id] = {
      ownerId: interaction.user.id,   // optional: restrict navigation to invoker
      page: 0,
      pages,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000
    };
  }
};