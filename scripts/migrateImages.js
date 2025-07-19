require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mongoose = require("mongoose");

// Flexible schema for migration
const cardSchema = new mongoose.Schema({}, { strict: false });
const Card = mongoose.model("Card", cardSchema, "cards");

const CARDS_DIR = "/var/cards";
const MONGO_URI = process.env.MONGO_URI;

function sleep(ms = 2000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
        console.log(`⏳ Retrying in 2s...`);
        await sleep(2000);
      }
    }
  }
  return false;
}

async function migrate() {
  await mongoose.connect(MONGO_URI);
  const allCards = await Card.find({});
  const cards = allCards.filter(card => !card.localImagePath && card.discordPermalinkImage);

  console.log(`🔍 Found ${cards.length} cards with Discord CDN images`);

  for (const card of cards) {
    const id = card._id.toString();
    const url = card.discordPermalinkImage;
    const localPath = path.join(CARDS_DIR, `${id}.png`);

    const success = await downloadImage(url, localPath);
    if (!success) {
      console.warn(`⛔ Failed on card ${id}`);
      continue;
    }

    card.localImagePath = localPath;
    await card.save();
    console.log(`💾 Card ${id} updated with localImagePath`);

    await sleep(); // delay per card
  }

  await mongoose.disconnect();
  console.log("🎉 Migration (Discord-only) complete");
}

migrate();