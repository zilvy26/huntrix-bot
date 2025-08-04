const { Api } = require('@top-gg/sdk');

const topgg = new Api(process.env.TOPGG_TOKEN); // store your API token in .env

module.exports = topgg;