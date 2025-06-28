require('dotenv').config();

module.exports = {
  token: process.env.TOKEN,
  mongoURI: process.env.MONGO_URI,
  prefix: '!',
};