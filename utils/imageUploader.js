const axios = require('axios');
const FormData = require('form-data');

/**
 * Upload image to Discord storage channel + Imgur
 * @param {Client} client - Discord client
 * @param {string} imageUrl - Original URL from the slash command attachment
 * @param {string} name - Card name for message context
 * @param {string} cardCode - Unique card code
 * @returns {Promise<{ discordUrl: string, imgurUrl: string | null }>}
 */
module.exports = async function uploadCardImage(client, imageUrl, name, cardCode) {
  const channel = client.channels.cache.get(process.env.CARD_STORAGE_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) {
    throw new Error('⚠️ Storage channel not found or invalid.');
  }

  // 1. Upload to Discord
  let discordUrl;
  try {
    const msg = await channel.send({
      content: `📤 Upload for card: ${cardCode} — ${name}`,
      files: [imageUrl]
    });
    discordUrl = msg.attachments.first()?.url;

    if (!discordUrl) {
      console.error('❌ No attachment URL returned from Discord upload.');
      throw new Error('❌ Failed to upload image to Discord.');
    }
  } catch (err) {
    console.error('❌ Discord upload failed:', err.message);
    throw new Error('❌ Discord upload failed.');
  }

  // 2. Upload to Imgur (optional)
  let imgurUrl = null;
  try {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const form = new FormData();
    form.append('image', Buffer.from(response.data).toString('base64'));

    const imgur = await axios.post('https://api.imgur.com/3/image', form, {
      headers: {
        Authorization: `Client-ID ${process.env.IMGUR_CLIENT_ID}`,
        ...form.getHeaders()
      }
    });

    imgurUrl = imgur.data?.data?.link || null;
  } catch (err) {
    console.error('❌ Imgur upload failed:', err.message);
  }

  return { discordUrl, imgurUrl };
};