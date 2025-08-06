module.exports = async function safeReply(interaction, options = {}, retries = 3, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      if (interaction.replied || interaction.deferred) {
        return await interaction.editReply(options);
      } else {
        return await interaction.reply(options);
      }
    } catch (err) {
      // Retry on Discord service unavailable (503) or unknown interaction (10062)
      const isRetryable = err.status === 503 || err.code === 10062;

      if (isRetryable && i < retries - 1) {
        const waitTime = delay * Math.pow(2, i); // exponential backoff
        console.warn(`Retrying reply attempt ${i + 1} after ${waitTime}ms...`);
        await new Promise(res => setTimeout(res, waitTime));
      } else {
        console.warn('❌ Failed to reply to interaction:', err.message || err);
        return null;
      }
    }
  }
};