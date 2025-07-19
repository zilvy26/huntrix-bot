const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mongoose = require("mongoose");
const Card = require("../models/Card"); // adjust if needed

const CARDS_DIR = "/var/cards";
const MONGO_URI = "mongodb://localhost:27017/your-db-name"; // Replace

async function downloadImage(url, destPath) {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    fs.writeFileSync(destPath, response.data);
    console.log(`✅ Saved image to ${destPath}`);
  } catch (err) {
    console.error(`❌ Failed to download ${url}: ${err.message}`);
  }
}

async function migrate() {
  await mongoose.connect(MONGO_URI);
  const cards = await Card.find({});

  for (const card of cards) {
    const id = card._id.toString();
    const localPath = path.join(CARDS_DIR, `${id}.png`);
    if (fs.existsSync(localPath)) {
      console.log(`🔁 Already exists: ${localPath}`);
      continue;
    }

    const url = card.imgurImageLink || card.discordPermalinkImage;
    if (!url) {
      console.warn(`⚠️ No URL found for card ${id}`);
      continue;
    }

    await downloadImage(url, localPath);
  }

  await mongoose.disconnect();
  console.log("🎉 Migration complete");
}

migrate();