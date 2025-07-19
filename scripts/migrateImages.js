require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mongoose = require("mongoose");

// Flexible schema just for migration
const cardSchema = new mongoose.Schema({}, { strict: false });
const Card = mongoose.model("Card", cardSchema, "cards");

const CARDS_DIR = "/var/cards";
const MONGO_URI = process.env.MONGO_URI;

// Utility to pause between requests
function sleep(ms = 7000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Downloads image with retries
async function downloadImage(url, destPath, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, { responseType: "arraybuffer" });
      fs.writeFileSync(destPath, response.data);
      console.log(`✅ Saved to ${destPath}`);
      return true;
    } catch (err) {
      console.error(`❌ Attempt ${attempt} failed for ${url}: ${err.message}`);
      if (attempt < retries) {
        console.log(`⏳ Retrying in 7s...`);
        await sleep();
      }
    }
  }
  return false;
}

async function migrate() {
  await mongoose.connect(MONGO_URI);
  const allCards = await Card.find({});
  const cards = allCards.filter(card => !card.localImagePath && (card.imgurImageLink || card.discordPermalinkImage)).slice(0, 25);

  console.log(`🔍 Found ${cards.length} cards needing migration`);

  for (const card of cards) {
    const id = card._id.toString();
    const localPath = path.join(CARDS_DIR, `${id}.png`);

    const url = card.imgurImageLink || card.discordPermalinkImage;
    if (!url) {
      console.warn(`⚠️ No URL found for card ${id}`);
      continue;
    }

    const success = await downloadImage(url, localPath);
    if (!success) {
      console.warn(`⛔ Skipping card ${id}`);
      continue;
    }

    card.localImagePath = localPath;
    await card.save();
    console.log(`💾 Card ${id} updated with localImagePath`);

    await sleep(); // slow down each request
  }

  await mongoose.disconnect();
  console.log("🎉 Migration complete for this batch.");
}

migrate();