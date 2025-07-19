/**
 * Generates the public URL for a card image hosted on your Hetzner Nginx server.
 * 
 * @param {string} cardCode - The code of the card (e.g. "JJK-TF01")
 * @returns {string} Public URL of the card image
 */
function getCardImageURL(cardCode) {
  const baseUrl = 'http://178.156.178.188/cards';
  return `${baseUrl}/${cardCode}.png`;
}

module.exports = { getCardImageURL };