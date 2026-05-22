import {
  fees,
  ForgeValidationError,
  LP_SEED_MIN_SOL,
  LP_SEED_MIN_LAMPORTS,
  RAYDIUM_POOL_FEE_SOL,
  RAYDIUM_POOL_FEE_LAMPORTS,
  PLATFORM_FEE_LAMPORTS,
  LP_SPLIT_BPS,
  SWAP_FEE_PCT,
  SWAP_FEE_RATE,
  VALID_TIERS,
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

// ── Schedule constants ────────────────────────────────────────────────────────

console.log('\nschedule constants');

assert('LP_SEED_MIN_SOL = 0.65',           LP_SEED_MIN_SOL === 0.65);
assert('LP_SEED_MIN_LAMPORTS = 650M',      LP_SEED_MIN_LAMPORTS === 650_000_000n);
assert('RAYDIUM_POOL_FEE_SOL = 0.15',      RAYDIUM_POOL_FEE_SOL === 0.15);
assert('RAYDIUM_POOL_FEE_LAMPORTS = 150M', RAYDIUM_POOL_FEE_LAMPORTS === 150_000_000n);
assert('platform fee quick = 0n',          PLATFORM_FEE_LAMPORTS.quick === 0n);
assert('platform fee safe = 500M',         PLATFORM_FEE_LAMPORTS.safe === 500_000_000n);
assert('VALID_TIERS has quick and safe',   VALID_TIERS.includes('quick') && VALID_TIERS.includes('safe'));

assert('LP_SPLIT_BPS quick sums to 10000',
  LP_SPLIT_BPS.quick.platform + LP_SPLIT_BPS.quick.creator + LP_SPLIT_BPS.quick.burned === 10_000);
assert('LP_SPLIT_BPS safe sums to 10000',
  LP_SPLIT_BPS.safe.platform + LP_SPLIT_BPS.safe.creator + LP_SPLIT_BPS.safe.locked === 10_000);

assert('SWAP_FEE_PCT quick = 2',   SWAP_FEE_PCT.quick === 2);
assert('SWAP_FEE_PCT safe = 1',    SWAP_FEE_PCT.safe === 1);
assert('SWAP_FEE_RATE quick = 20000', SWAP_FEE_RATE.quick === 20_000);
assert('SWAP_FEE_RATE safe = 10000',  SWAP_FEE_RATE.safe === 10_000);

// ── fees() validation ─────────────────────────────────────────────────────────

console.log('\nfees()validation');

assertThrows('rejects missing name',     () => fees(),      ForgeValidationError);
assertThrows('rejects non-string name',  () => fees(42),    ForgeValidationError);
assertThrows('rejects invalid tier',     () => fees('x').tier('turbo'),  ForgeValidationError);
assertThrows('rejects zero seed',        () => fees('x').tier('quick').seed(0),    ForgeValidationError);
assertThrows('rejects negative seed',    () => fees('x').tier('quick').seed(-1),   ForgeValidationError);
assertThrows('rejects seed below min',   () => fees('x').tier('quick').seed(0.3),  ForgeValidationError);
assertThrows('platform() without tier',  () => fees('x').platform(),               ForgeValidationError);
assertThrows('total() without tier',     () => fees('x').seed(0.65).total(),       ForgeValidationError);
assertThrows('total() without seed',     () => fees('x').tier('quick').total(),    ForgeValidationError);
assertThrows('split() without tier',     () => fees('x').split(1_000_000n),        ForgeValidationError);
assertThrows('split() zero supply',      () => fees('x').tier('quick').split(0n),  ForgeValidationError);
assertThrows('swapRate() without tier',  () => fees('x').swapRate(),               ForgeValidationError);

// ── fees()quick tier ───────────────────────────────────────────────────────

console.log('\nfees()quick tier');

const fq = fees('launch-quick').tier('quick').seed(0.65);

assert('quick platform() = 0n',       fq.platform() === 0n);
assert('quick total() = seed only',   fq.total() === 650_000_000n,   `got ${fq.total()}`);

const splitQ = fq.split(1_000_000n);
assert('quick split has platform',    'platform' in splitQ);
assert('quick split has creator',     'creator'  in splitQ);
assert('quick split has burned',      'burned'   in splitQ);
assert('quick split no locked key',   !('locked' in splitQ));
assert('quick split sums to supply',  splitQ.platform + splitQ.creator + splitQ.burned === 1_000_000n,
  `got ${splitQ.platform + splitQ.creator + splitQ.burned}`);
assert('quick split creator = 10%',   splitQ.creator === 100_000n,  `got ${splitQ.creator}`);
assert('quick split burned = 70%',    splitQ.burned  === 700_000n,  `got ${splitQ.burned}`);
assert('quick split platform = 20%',  splitQ.platform === 200_000n, `got ${splitQ.platform}`);

const swapQ = fq.swapRate();
assert('quick swapRate pct = 2',      swapQ.pct === 2);
assert('quick swapRate rate = 20000', swapQ.rate === 20_000);

// ── fees()safe tier ────────────────────────────────────────────────────────

console.log('\nfees()safe tier');

const fs = fees('launch-safe').tier('safe').seed(0.65);

assert('safe platform() = 500M',      fs.platform() === 500_000_000n);
assert('safe total() = fee + seed',   fs.total() === 1_150_000_000n, `got ${fs.total()}`);

const splitS = fs.split(1_000_000n);
assert('safe split has platform',     'platform' in splitS);
assert('safe split has creator',      'creator'  in splitS);
assert('safe split has locked',       'locked'   in splitS);
assert('safe split no burned key',    !('burned' in splitS));
assert('safe split sums to supply',   splitS.platform + splitS.creator + splitS.locked === 1_000_000n,
  `got ${splitS.platform + splitS.creator + splitS.locked}`);
assert('safe split creator = 15%',    splitS.creator  === 150_000n, `got ${splitS.creator}`);
assert('safe split locked = 75%',     splitS.locked   === 750_000n, `got ${splitS.locked}`);
assert('safe split platform = 10%',   splitS.platform === 100_000n, `got ${splitS.platform}`);

const swapS = fs.swapRate();
assert('safe swapRate pct = 1',       swapS.pct === 1);
assert('safe swapRate rate = 10000',  swapS.rate === 10_000);

// ── fees()seed validation boundary ────────────────────────────────────────

console.log('\nfees()seed boundary');

assertThrows('seed 0.64 rejected',    () => fees('x').tier('quick').seed(0.64),  ForgeValidationError);
const fBoundary = fees('x').tier('quick').seed(0.65);
assert('seed 0.65 accepted',          fBoundary.total() === 650_000_000n);

const fHighSeed = fees('x').tier('safe').seed(2.0);
assert('safe 2 SOL seed: total = fee + 2 SOL',
  fHighSeed.total() === 500_000_000n + 2_000_000_000n,
  `got ${fHighSeed.total()}`);

// ── fees()split rounding ───────────────────────────────────────────────────

console.log('\nfees()split rounding');

// Supply not cleanly divisible by basis points
const splitOdd = fees('x').tier('quick').split(1_000_001n);
assert('odd supply: parts sum to exact supply',
  splitOdd.platform + splitOdd.creator + splitOdd.burned === 1_000_001n,
  `got ${splitOdd.platform + splitOdd.creator + splitOdd.burned}`);

// Large supplyrealistic LP token amount
const LP_SUPPLY = 1_000_000_000_000n;  // 1T raw units
const splitLarge = fees('x').tier('quick').split(LP_SUPPLY);
assert('large supply: creator = 10%',  splitLarge.creator  === 100_000_000_000n);
assert('large supply: burned  = 70%',  splitLarge.burned   === 700_000_000_000n);
assert('large supply: platform= 20%',  splitLarge.platform === 200_000_000_000n);
assert('large supply: sums correctly',
  splitLarge.platform + splitLarge.creator + splitLarge.burned === LP_SUPPLY);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n--- @forgekit-labs/fees ---`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
