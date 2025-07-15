const VanityTracker = require('../models/VanityTracker');

module.exports = async function vanityRoleChecker(client) {
  const guild = await client.guilds.fetch('1386796809015525498');
  const vanityRoleId = '1394448143206322267';
  const phrase = '/huntrixbot';

  try {
    const members = await guild.members.fetch();

    for (const member of members.values()) {
      const hasVanity = member.presence?.activities?.some(
        act => act.state?.toLowerCase().includes(phrase)
      ) ?? false;

      const record = await VanityTracker.findOne({ userId: member.id });

      const previouslyHadVanity = record?.hasVanity ?? null;
      if (previouslyHadVanity === hasVanity) continue;

      // Update DB
      await VanityTracker.findOneAndUpdate(
        { userId: member.id },
        { hasVanity, lastChecked: new Date() },
        { upsert: true, new: true }
      );

      const hasRole = member.roles.cache.has(vanityRoleId);

      if (hasVanity && !hasRole) {
        await member.roles.add(vanityRoleId).catch(console.error);
      } else if (!hasVanity && hasRole) {
        await member.roles.remove(vanityRoleId).catch(console.error);
      }
    }
  } catch (err) {
    console.error('💥 Error in vanityRoleChecker:', err);
  }
};