const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mongoose = require("mongoose");
const Card = require("../models/Card");

const CARDS_DIR = "/var/cards";
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI environment variable is not set!");
  process.exit(1);
}

async function downloadImage(url, destPath) {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    fs.writeFileSync(destPath, response.data);
    console.log(`✅ Saved image to ${destPath}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to download ${url}: ${err.message}`);
    return false;
  }
}

async function migrate() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("🔌 Connected to MongoDB");

    const cards = await Card.find({});
    console.log(`📦 Found ${cards.length} cards`);

    for (const card of cards) {
      const id = card._id.toString();
      const fileName = `${id}.png`;
      const localPath = path.join(CARDS_DIR, fileName);

      if (fs.existsSync(localPath)) {
        console.log(`🔁 Already exists: ${localPath}`);
        continue;
      }

      const url = card.imgurImageLink || card.discordPermalinkImage;
      if (!url) {
        console.warn(`⚠️ No image URL found for card ${id}`);
        continue;
      }

      const success = await downloadImage(url, localPath);
      if (success) {
        card.localImagePath = localPath;
        await card.save();
        console.log(`📝 Updated card ${id} with localImagePath`);
      }
    }

    console.log("🎉 Migration complete");
  } catch (err) {
    console.error("💥 Migration failed:", err);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  }
}

migrate();