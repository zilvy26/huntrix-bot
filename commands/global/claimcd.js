// commands/cds/claimcd.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const CD = require('../../models/CD');
const UserCD = require('../../models/UserCD');
const { hasCompleteEra } = require('../../services/eligibility'); // your existing helper

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

      // Already claimed?
      const already = await UserCD.findOne({ userId: interaction.user.id, cdId: cd._id });
      if (already) {
        return interaction.editReply({ content: `You have already claimed **${cd.title}**.` });
      }

      // Eligibility check
      let eligible = false;
      let reasons = [];

      if (cd.active) {
        if (!cd.activeEra) {
          reasons.push('CD has no Active Era set; cannot validate eligibility.');
        } else {
          const hasActive = await hasCompleteEra(interaction.user.id, cd.activeEra);
          eligible = hasActive;
          if (!hasActive) reasons.push(`Missing required cards for Active Era **${cd.activeEra}**.`);
        }
      } else {
        if (!cd.activeEra || !cd.inactiveEra) {
          reasons.push('CD requires both eras, but one or both eras are not set.');
        } else {
          const [hasActive, hasInactive] = await Promise.all([
            hasCompleteEra(interaction.user.id, cd.activeEra),
            hasCompleteEra(interaction.user.id, cd.inactiveEra),
          ]);
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

      // Record claim
      await UserCD.create({ userId: interaction.user.id, cdId: cd._id });

      // Build success embed + include CD image if available
      const embed = new EmbedBuilder()
        .setTitle(`${cd.title} claimed`)
        .setColor('Green')
        .addFields(
          { name: 'Required', value: cd.active ? 'Active Era' : 'Active + Inactive Eras' },
          { name: 'Active Era', value: cd.activeEra || '—' },
          { name: 'Inactive Era', value: cd.inactiveEra || '—' },
          { name: 'Claimed By', value: `<@${interaction.user.id}>` }
        );

      const files = [];
      if (cd.localImagePath && fs.existsSync(cd.localImagePath)) {
        // Use color image on claim
        const ext = path.extname(cd.localImagePath) || '.png';
        const attachName = `cd_${cd._id}_color${ext}`;
        files.push(new AttachmentBuilder(cd.localImagePath, { name: attachName }));
        embed.setImage(`attachment://${attachName}`);
      }

      return interaction.editReply({ embeds: [embed], files });
    } catch (err) {
      console.error('Error in /claimcd:', err);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({ content: 'There was an error executing the command.', ephemeral: true });
      }
    }
  }
};
