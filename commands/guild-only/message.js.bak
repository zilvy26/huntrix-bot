const { SlashCommandBuilder, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('message')
    .setDescription('Send a message as the bot to a specific channel')
    .setDefaultMemberPermissions('0')
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to send the message in')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('text')
        .setDescription('Message content to send')
        .setRequired(true)
    ),
  
  async execute(interaction) {
    // ✅ Optional: Admin check
    const ALLOWED_ROLE_ID = '1386797486680703036'; // replace with your actual role ID

    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
    return interaction.reply({ content: 'Only authorized staff can use this command.' });
}

    const channel = interaction.options.getChannel('channel');
    const text = interaction.options.getString('text');

    try {
      await channel.send({ content: text });
      await interaction.reply({ content: `Message sent to ${channel}`,  flags: 1 << 6 });
    } catch (err) {
      console.error('Failed to send message:', err);
      await interaction.reply({ content: 'Failed to send the message.',  flags: 1 << 6 });
    }
  }
};