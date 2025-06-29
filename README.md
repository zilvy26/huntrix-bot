# Huntrix Discord Bot

Huntrix is a collectible/trading Discord Anime, Kpop & Game card bot built with Node.js, Discord.js, and MongoDB.

## Features

- `!register` to create a new account
- `!inventory` to see your cards (coming soon)
- `!pull` to pull cards from the database
- MongoDB database to store user profiles and cards
- Deployable on Railway

## Setup

```bash
npm install
node src/index.js```

### .env variables
```env
TOKEN=your-discord-token
MONGO_URI=your-mongo-uri```