// scripts/inspectTargetsOnly.js
// Usage examples:
//   node scripts/inspectTargetsOnly.js --rarity 5
//   node scripts/inspectTargetsOnly.js --all
//
// Shows ONLY the configured era and code multipliers' expected shares,
// normalized against all pullable cards in each rarity bucket.

require('dotenv').config();
const mongoose = require('mongoose');
const Card = require('../models/Card');
const { getGlobalPullConfig } = require('../utils/globalPullConfig');

// ---------- CLI args ----------
const args = process.argv.slice(2);
const has = f => args.includes(f);
const getNum = (flag, def) => {
  const i = args.indexOf(flag);
  if (i === -1) return def;
  const v = Number(args[i + 1]);
  return Number.isFinite(v) ? v : def;
};
const RARITY = getNum('--rarity', null);
const ALL = has('--all');

if (!process.env.MONGO_URI) {
  console.error('❌ MONGODB_URI not set in .env'); process.exit(1);
}

// ---------- helpers ----------
const pct = n => (n * 100).toFixed(2) + '%';
const norm = x => (x == null ? '' : String(x).trim().toLowerCase());

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

function printTable(title, rows, cols) {
  console.log(`\n== ${title} ==`);
  // compute widths
  const widths = cols.map(c =>
    Math.max(c.header.length, ...rows.map(r => String(r[c.key]).length)) + 2
  );
  // header
  console.log(cols.map((c, i) => c.header.padEnd(widths[i])).join(''));
  // rows
  for (const r of rows) {
    console.log(cols.map((c, i) => String(r[c.key]).padEnd(widths[i])).join(''));
  }
}

async function analyzeRarity(rarity) {
  console.log(`\n→ Loading pullable cards for rarity ${rarity}…`);
  const cards = await Card.find({ pullable: true, rarity })
    .select({ era: 1, cardCode: 1 })  // small payload
    .lean();

  if (!cards.length) {
    console.log('(no cards found)'); return;
  }

  const cfg = getGlobalPullConfig();
  // normalize keys of config maps to lowercase once
  const eraMult = Object.fromEntries(
    Object.entries(cfg.eraMultipliers || {}).map(([k, v]) => [norm(k), Number(v)])
  );
  const codeMult = Object.fromEntries(
    Object.entries(cfg.codeMultipliers || {}).map(([k, v]) => [norm(k), Number(v)])
  );
  const minW = cfg.minWeight ?? 0.00001;
  const maxW = cfg.maxWeight ?? 10000;

  // Targets = only keys present in your config
  const eraTargets = new Set(Object.keys(eraMult));
  const codeTargets = new Set(Object.keys(codeMult));

  let totalW = 0;

  // Sums for only the targets (plus "others")
  const eraSum = Object.fromEntries([...eraTargets].map(k => [k, 0]));
  let eraOthers = 0;

  const codeSum = Object.fromEntries([...codeTargets].map(k => [k, 0]));
  let codeOthers = 0;

  for (const c of cards) {
    const e = norm(c.era);
    const cd = norm(c.cardCode);

    const mEra = Object.prototype.hasOwnProperty.call(eraMult, e) ? eraMult[e] : 1;
    const mCode = Object.prototype.hasOwnProperty.call(codeMult, cd) ? codeMult[cd] : 1;
    const w = clamp(1 * mEra * mCode, minW, maxW);

    totalW += w;

    if (eraTargets.has(e)) eraSum[e] += w;
    else eraOthers += w;

    if (codeTargets.has(cd)) codeSum[cd] += w;
    else codeOthers += w;
  }

  // Build printable rows
  const eraRows = Object.keys(eraSum)
    .sort((a, b) => eraSum[b] - eraSum[a])
    .map(k => ({ key: k, share: pct(totalW ? eraSum[k] / totalW : 0) }));
  eraRows.push({ key: '(others)', share: pct(totalW ? eraOthers / totalW : 0) });

  const codeRows = Object.keys(codeSum)
    .sort((a, b) => codeSum[b] - codeSum[a])
    .map(k => ({ key: k, share: pct(totalW ? codeSum[k] / totalW : 0) }));
  codeRows.push({ key: '(others)', share: pct(totalW ? codeOthers / totalW : 0) });

  printTable(`Rarity ${rarity} · ERA multipliers (share of pulls)`, eraRows, [
    { header: 'Era', key: 'key' },
    { header: 'Expected Share', key: 'share' },
  ]);

  printTable(`Rarity ${rarity} · CODE multipliers (share of pulls)`, codeRows, [
    { header: 'Code', key: 'key' },
    { header: 'Expected Share', key: 'share' },
  ]);
}

async function main() {
  console.log('→ Connecting to Mongo…');
  await mongoose.connect(process.env.MONGO_URI);

  if (ALL) {
    const rarities = await Card.distinct('rarity', { pullable: true });
    const sorted = rarities.sort((a, b) => Number(a) - Number(b));
    for (const r of sorted) {
      await analyzeRarity(r);
    }
  } else if (RARITY != null) {
    await analyzeRarity(RARITY);
  } else {
    console.log('Pass --rarity <n> or --all, e.g.:');
    console.log('  node scripts/inspectTargetsOnly.js --rarity 5');
    console.log('  node scripts/inspectTargetsOnly.js --all');
  }

  await mongoose.disconnect();
  console.log('\n✅ Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
