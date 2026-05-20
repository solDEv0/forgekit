import {
  curve,
  lamportsToSol,
  solToLamports,
  pricePerToken,
  spotPrice,
  progress,
  marketCap,
  basisOf,
  ForgeValidationError,
} from './src/index.js';

let passed = 0;
let failed = 0;

function pass(label) { console.log(`  PASS  ${label}`); passed++; }
function fail(label, detail) { console.error(`  FAIL  ${label}\n        ${detail}`); failed++; process.exitCode = 1; }

function assert(label, condition, detail = '') {
  if (condition) pass(label);
  else fail(label, detail || 'assertion failed');
}

function assertThrows(label, fn, ErrorClass) {
  try {
    fn();
    fail(label, 'Expected an error but none was thrown');
  } catch (err) {
    if (err instanceof ErrorClass) pass(label);
    else fail(label, `Expected ${ErrorClass.name}, got ${err?.constructor?.name}: ${err?.message}`);
  }
}

function assertClose(label, actual, expected, tolerance = 1e-10) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) pass(label);
  else fail(label, `expected ≈${expected}, got ${actual} (diff: ${diff})`);
}

// ── curve() validation ────────────────────────────────────────────────────────

console.log('\ncurve()validation');

assertThrows('rejects missing name',          () => curve(),           ForgeValidationError);
assertThrows('rejects non-string name',       () => curve(42),         ForgeValidationError);
assertThrows('rejects zero supply',           () => curve('x').supply(0),           ForgeValidationError);
assertThrows('rejects negative supply',       () => curve('x').supply(-1),          ForgeValidationError);
assertThrows('rejects bad decimals',          () => curve('x').decimals(19),        ForgeValidationError);
assertThrows('rejects zero solPrice',         () => curve('x').solPrice(0),         ForgeValidationError);
assertThrows('rejects negative solPrice',     () => curve('x').solPrice(-5),        ForgeValidationError);
assertThrows('startPrice without supply',     () => curve('x').solPrice(180).startPrice(5_000), ForgeValidationError);
assertThrows('startPrice without solPrice',   () => curve('x').supply(1e9).startPrice(5_000),   ForgeValidationError);
assertThrows('graduationAt without solPrice', () => curve('x').graduationAt(50_000),             ForgeValidationError);
assertThrows('marketCap without supply',      () => curve('x').solPrice(180).marketCap(0.001),   ForgeValidationError);
assertThrows('marketCap without solPrice',    () => curve('x').supply(1e9).marketCap(0.001),     ForgeValidationError);
assertThrows('progress missing raised',       () => curve('x').progress(null, 1000n),            ForgeValidationError);
assertThrows('progress missing threshold',    () => curve('x').progress(500n, null),             ForgeValidationError);

// ── curve() computestartPrice ─────────────────────────────────────────────

console.log('\ncurve()startPrice');

// STLP production defaults: $5K start MC, 980M supply (post-2%-burn), $180 SOL
const SUPPLY    = 980_000_000;
const SOL_PRICE = 180;
const c = curve('my-token').supply(SUPPLY).solPrice(SOL_PRICE);

const mintInitPrice = c.startPrice(5_000);
// expected: 5000 / 980_000_000 / 180 ≈ 2.834e-8 SOL per token
assertClose('startPrice: $5K MC, 980M supply, $180 SOL',
  mintInitPrice,
  5_000 / SUPPLY / SOL_PRICE,
);
assert('startPrice returns a positive number', typeof mintInitPrice === 'number' && mintInitPrice > 0);
assert('higher startMc → higher startPrice', c.startPrice(10_000) > mintInitPrice);

// ── curve() computegraduationAt ───────────────────────────────────────────

console.log('\ncurve()graduationAt');

const threshold = c.graduationAt(50_000);
// $50K MC at $180/SOL = 277.77... SOL = 277_777_777_778 lamports
assert('graduationAt returns a BigInt', typeof threshold === 'bigint');
assert('graduationAt: $50K MC at $180 SOL ≈ 277.7 SOL in lamports',
  threshold >= 277_000_000_000n && threshold <= 278_000_000_000n,
  `got ${threshold}`,
);
assert('higher gradMc → higher threshold', c.graduationAt(100_000) > threshold);

// Round-trip: threshold → recover original grad MC within $1
const recoveredMcUsd = Number(threshold) / 1e9 * SOL_PRICE;
assertClose('graduationAt round-trip: threshold → MC ≈ $50K', recoveredMcUsd, 50_000, 1);

// ── curve() computeprogress ───────────────────────────────────────────────

console.log('\ncurve()progress');

const { pct: pct0, remaining: rem0 } = c.progress(0n, threshold);
assert('0 raised → 0% progress', pct0 === 0, `got ${pct0}`);
assert('0 raised → remaining = threshold', rem0 === threshold, `got ${rem0}`);

const halfRaised = threshold / 2n;
const { pct: pct50, remaining: rem50 } = c.progress(halfRaised, threshold);
assertClose('half raised → ~50% progress', pct50, 50, 0.1);
assert('half raised → remaining = half threshold', rem50 === threshold - halfRaised, `got ${rem50}`);

const { pct: pct100, remaining: rem100 } = c.progress(threshold, threshold);
assert('fully raised → 100%', pct100 === 100, `got ${pct100}`);
assert('fully raised → 0 remaining', rem100 === 0n, `got ${rem100}`);

const { pct: pctOver } = c.progress(threshold * 2n, threshold);
assert('over threshold → capped at 100%', pctOver === 100, `got ${pctOver}`);

// ── curve() computemarketCap ──────────────────────────────────────────────

console.log('\ncurve()marketCap');

const spotSol = mintInitPrice;  // at launch, spot price = starting price
const mc = c.marketCap(spotSol);
// FDV = startPrice × SUPPLY × SOL_PRICE ≈ $5000
assertClose('marketCap at launch ≈ startMc', mc, 5_000, 1);
assert('zero spot price → zero MC', c.marketCap(0) === 0);

// ── lamportsToSol ─────────────────────────────────────────────────────────────

console.log('\nlamportsToSol');

assert('1.5 SOL',         lamportsToSol(1_500_000_000n) === '1.500000000');
assert('0 SOL',           lamportsToSol(0n)             === '0.000000000');
assert('0.65 SOL',        lamportsToSol(650_000_000n)   === '0.650000000');
assert('negative',        lamportsToSol(-1_000_000_000n) === '-1.000000000');
assert('4 dp precision',  lamportsToSol(1_500_000_000n, 4) === '1.5000');
assert('string input',    lamportsToSol('1000000000')   === '1.000000000');
assert('number input',    lamportsToSol(1000000000)     === '1.000000000');

// ── solToLamports ─────────────────────────────────────────────────────────────

console.log('\nsolToLamports');

assert('1.5 SOL → 1_500_000_000n', solToLamports(1.5)    === 1_500_000_000n);
assert('0.65 SOL',                  solToLamports(0.65)   === 650_000_000n);
assert('0.001 SOL',                 solToLamports(0.001)  === 1_000_000n);
assert('string input',              solToLamports('1.5')  === 1_500_000_000n);

// ── pricePerToken ─────────────────────────────────────────────────────────────

console.log('\npricePerToken');

// 0.65 SOL for 1M whole tokens (6 dp → 1_000_000_000_000 raw) → 6.5e-7 SOL/token
// pricePerToken takes raw units + decimals
const ppt = pricePerToken(650_000_000n, 1_000_000_000_000n, 6);
assert('pricePerToken returns a string',            typeof ppt === 'string');
assert('0.65 SOL / 1M tokens → 0.00000065 SOL/token',
  ppt.startsWith('0.000000650'),
  `got ${ppt}`,
);

// Zero numerator
assert('zero sol → "0"', pricePerToken(0n, 1_000_000n, 6) === '0');
// Zero denominator
assert('zero tokens → "0"', pricePerToken(1_000_000n, 0n, 6) === '0');

// Sanity: higher SOL → higher price
const pptHigh = pricePerToken(1_300_000_000n, 1_000_000_000_000n, 6);
assert('2× sol → 2× price', pptHigh.startsWith('0.000001300'), `got ${pptHigh}`);

// ── spotPrice ────────────────────────────────────────────────────────────────

console.log('\nspotPrice');

// Pool: 100 SOL (100_000_000_000 lamports), 500M tokens (6dp → 500_000_000_000_000 raw)
// price = 100 / 500_000_000 / ... = 2e-7 SOL/token
const sp = spotPrice(100_000_000_000n, 500_000_000_000_000n, 6);
assert('spotPrice returns a string', typeof sp === 'string');
assert('100 SOL / 500M tokens → 0.0000002 SOL/token',
  sp.startsWith('0.000000200'),
  `got ${sp}`,
);

// spotPrice = pricePerToken (same formula)
assert('spotPrice === pricePerToken for same inputs',
  spotPrice(100_000_000_000n, 500_000_000_000_000n, 6) ===
  pricePerToken(100_000_000_000n, 500_000_000_000_000n, 6),
);

// ── progress (standalone) ────────────────────────────────────────────────────

console.log('\nprogress (standalone)');

const { pct: p1, remaining: r1 } = progress(250_000_000n, 1_000_000_000n);
assertClose('25% progress', p1, 25, 0.01);
assert('remaining = 750M', r1 === 750_000_000n, `got ${r1}`);

const { pct: p2 } = progress(0n, 0n);
assert('zero threshold → 100% (graduated)', p2 === 100);

// ── marketCap (standalone) ───────────────────────────────────────────────────

console.log('\nmarketCap (standalone)');

// 0.0001 SOL/token × 1_000_000_000 supply × $180/SOL = $18_000_000
assertClose('FDV calculation', marketCap(0.0001, 1_000_000_000, 180), 18_000_000, 1);

// ── basisOf ──────────────────────────────────────────────────────────────────

console.log('\nbasisOf');

assert('20% of 1_000_000n', basisOf(1_000_000n, 2000) === 200_000n);
assert('75% of 1_000_000n', basisOf(1_000_000n, 7500) === 750_000n);
assert('100%',              basisOf(500n, 10_000) === 500n);
assert('0%',                basisOf(999_999n, 0)  === 0n);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n--- @forgekit/curve ---`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
