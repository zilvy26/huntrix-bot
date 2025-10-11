// utils/wrapText.js
function getGraphemes(str) {
  // Prefer Intl.Segmenter (Node 16+); fallback to Array.from (codepoints)
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter('und', { granularity: 'grapheme' });
    return Array.from(seg.segment(str), s => s.segment);
  }
  return Array.from(str); // ok for most emoji/CJK
}

/**
 * Wrap text by measuring with the given 2D context.
 * - Honors explicit newlines
 * - Wraps long runs with no spaces (CJK, long URLs) by grapheme
 * @returns {string[]} lines
 */
module.exports = function wrapText(ctx, text, maxWidth) {
  const out = [];
  const paragraphs = String(text).replace(/\r\n?/g, '\n').split('\n');

  for (const para of paragraphs) {
    if (!para) { out.push(''); continue; }

    // Tokenize by spaces, but we’ll further split tokens that are too wide
    const tokens = para.split(' ').map(t => ({ t, space: true }))
      .flatMap(({ t, space }, i, arr) => (i === arr.length - 1 ? [{ t, space: false }] : [{ t, space: true }]));

    let line = '';

    function pushLine() {
      out.push(line.trimEnd());
      line = '';
    }

    for (const { t, space } of tokens) {
      // If token itself is too wide, split it by grapheme clusters
      const needsSplit = ctx.measureText(t).width > maxWidth;
      if (needsSplit) {
        const graphemes = getGraphemes(t);
        for (const g of graphemes) {
          const attempt = line + g;
          if (ctx.measureText(attempt).width > maxWidth && line) {
            pushLine();
          }
          line += g;
        }
        if (space) {
          const attempt = line + ' ';
          if (ctx.measureText(attempt).width > maxWidth && line) {
            pushLine();
          }
          line += ' ';
        }
        continue;
      }

      // Normal token path
      const attempt = line + t + (space ? ' ' : '');
      if (ctx.measureText(attempt).width > maxWidth && line) {
        pushLine();
        line = t + (space ? ' ' : '');
      } else {
        line = attempt;
      }
    }

    // Flush remainder
    out.push(line.trimEnd());
  }

  return out;
};