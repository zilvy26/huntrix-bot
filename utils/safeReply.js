let replyCount = 0; // Track how many times safeReply is called

module.exports = async function safeReply(interaction, options = {}, retries = 3, delay = 500) {
  replyCount++;

  console.log(`🧪 safeReply called (${replyCount}x) in command: ${interaction.commandName}`);

  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(options);
    } else {
      return await interaction.reply(options);
    }
  } catch (err) {
    const isRetryable = err.status === 503 || err.code === 10062;

    if (isRetryable && retries > 1) {
      const waitTime = delay * Math.pow(2, 3 - retries);
      console.warn(`🔁 Retrying reply attempt (${4 - retries}) after ${waitTime}ms...`);
      await new Promise(res => setTimeout(res, waitTime));
      return safeReply(interaction, options, retries - 1, delay);
    }

    console.warn(`❌ Failed to reply to interaction in "${interaction.commandName}":`, err.message || err);
    return null;
  }
};