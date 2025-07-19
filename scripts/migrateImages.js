require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mongoose = require("mongoose");

const CARDS_DIR = "/var/cards";
const MONGO_URI = process.env.MONGO_URI;

// Flexible schema for migration only
const cardSchema = new mongoose.Schema({}, { strict: false });
const Card = mongoose.model("Card", cardSchema, "cards");

// Utility: sleep for delay (default: 1500ms)
function sleep(ms = 1500) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Download image with optional retries
async function downloadImage(url, destPath, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, { responseType: "arraybuffer" });
      fs.writeFileSync(destPath, response.data);
      console.log(`✅ Saved image to ${destPath}`);
      return true;
    } catch (err) {
      console.error(`❌ Attempt ${attempt} failed to download ${url}: ${err.message}`);
      if (attempt < retries) {
        console.log(`⏳ Retrying in 2s...`);
        await sleep(2000);
      }
    }
  }
  return false;
}

async function migrate() {
  await mongoose.connect(MONGO_URI);
  const cards = await Card.find({});

  console.log(`🔍 Found ${cards.length} cards`);

  for (const card of cards) {
    const id = card._id.toString();
    const localPath = path.join(CARDS_DIR, `${id}.png`);

    if (card.localImagePath && fs.existsSync(card.localImagePath)) {
      console.log(`✔️ Already migrated: ${id}`);
      continue;
    }

    const url = card.imgurImageLink || card.discordPermalinkImage;
    if (!url) {
      console.warn(`⚠️ No image URL found for card ${id}`);
      continue;
    }

    const success = await downloadImage(url, localPath);
    if (!success) {
      console.warn(`⛔ Giving up on card ${id}`);
      continue;
    }

    card.localImagePath = localPath;
    await card.save();
    console.log(`💾 Updated card ${id} with localImagePath`);

    await sleep(); // Prevent rate limiting
  }

  await mongoose.disconnect();
  console.log("🎉 Migration complete");
}

migrate();