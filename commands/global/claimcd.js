// commands/cds/claimcd.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');

const CD = require('../../models/CD');
const UserCD = require('../../models/UserCD');
const { hasCompleteEra } = require('../../services/eligibility'); // reusing your helper :contentReference[oaicite:1]{index=1}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claimcd')
    .setDescription('Claim a CD if you meet the era requirements')
    .addStringOption(opt =>
      opt.setName('title')
        .setDescription('Title of the CD to claim')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      const title = interaction.options.getString('title', true).trim();

      // Find CD by title
      const cd = await CD.findOne({ title });
      if (!cd) {
        return interaction.editReply({ content: `No CD titled **${title}** was found.` });
      }

      if (!cd.available) {
        return interaction.editReply({ content: `CD **${cd.title}** is not available to claim.` });
      }

      // Check if already claimed by this user
      const already = await UserCD.findOne({ userId: interaction.user.id, cdId: cd._id });
      if (already) {
        return interaction.editReply({ content: `You have already claimed **${cd.title}**.` });
      }

      // Determine eligibility:
      // If active === true → only needs activeEra
      // If active === false → needs activeEra AND inactiveEra
      let eligible = false;
      let reasons = [];

      if (cd.active) {
        if (!cd.activeEra) {
          reasons.push('CD has no Active Era set; cannot validate eligibility.');
        } else {
          const hasActive = await hasCompleteEra(interaction.user.id, cd.activeEra); // uses your helper :contentReference[oaicite:2]{index=2}
          eligible = hasActive;
          if (!hasActive) {
            reasons.push(`Missing required cards for Active Era **${cd.activeEra}**.`);
          }
        }
      } else {
        if (!cd.activeEra || !cd.inactiveEra) {
          reasons.push('CD requires both eras, but one or both eras are not set.');
        } else {
          const [hasActive, hasInactive] = await Promise.all([
            hasCompleteEra(interaction.user.id, cd.activeEra),
            hasCompleteEra(interaction.user.id, cd.inactiveEra),
          ]); // both checks rely on your InventoryItem-based era completeness logic :contentReference[oaicite:3]{index=3}

          eligible = hasActive && hasInactive;
          if (!hasActive) reasons.push(`Missing required cards for Active Era **${cd.activeEra}**.`);
          if (!hasInactive) reasons.push(`Missing required cards for Inactive Era **${cd.inactiveEra}**.`);
        }
      }

      if (!eligible) {
        return interaction.editReply({
          content: `You are not eligible to claim **${cd.title}**.\n${reasons.map(r => `• ${r}`).join('\n')}`
        });
      }

      // Record the claim
      await UserCD.create({
        userId: interaction.user.id,
        cdId: cd._id
      });

      const embed = new EmbedBuilder()
        .setTitle('CD Claimed')
        .setColor('Green')
        .addFields(
          { name: 'Title', value: cd.title, inline: true },
          { name: 'Available', value: String(cd.available), inline: true },
          { name: 'Requires', value: cd.active ? 'Active Era only' : 'Active + Inactive Eras', inline: true },
          { name: 'Active Era', value: cd.activeEra || '—', inline: true },
          { name: 'Inactive Era', value: cd.inactiveEra || '—', inline: true },
          { name: 'Claimed By', value: `<@${interaction.user.id}>`, inline: true }
        );

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Error in /claimcd:', err);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({ content: 'There was an error executing the command.', ephemeral: true });
      }
    }
  }
};
