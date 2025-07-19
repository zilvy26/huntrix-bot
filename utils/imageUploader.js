// utils/imageUploader.js
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

module.exports = async function uploadImageFromAttachment(attachment) {
  if (!attachment || !attachment.url) {
    throw new TypeError("❌ Invalid attachment object: missing 'url'");
  }

  const imageUrl = attachment.url;
  const ext = path.extname(imageUrl.split('?')[0]) || '.png'; // fallback if no ext
  const fileName = `${uuidv4()}${ext}`;
  const filePath = `/var/cards/${fileName}`;

  const writer = fs.createWriteStream(filePath);

  const response = await axios({
    url: imageUrl,
    method: "GET",
    responseType: "stream",
  });

  await new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  return { localPath: filePath }; // ✅ Local path to store in your DB
};