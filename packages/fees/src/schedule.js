/**
 * Canonical fee schedule. Single source of truth for all launchpad fees.
 * Every value is derived from production experience on Solana mainnet.
 */

// ── LP seed ───────────────────────────────────────────────────────────────────

/**
 * 0.65 SOL total:
 *   0.15 SOL is consumed by Raydium as the CPMM pool creation fee
 *   0.50 SOL is the actual pool liquidity (Raydium rejects anything below this)
 *
 * Sending less than 0.65 SOL results in InstructionError [2, { Custom: 1 }]
 * on-chain. A silent failure with no useful error message from the SDK.
 */
export const LP_SEED_MIN_SOL           = 0.65;
export const LP_SEED_MIN_LAMPORTS      = 650_000_000n;
export const RAYDIUM_POOL_FEE_SOL      = 0.15;
export const RAYDIUM_POOL_FEE_LAMPORTS = 150_000_000n;

// ── Platform flat fees ────────────────────────────────────────────────────────

/**
 * In ADDITION to the LP seed. Total payment = platformFee + lpSeed.
 * quick: free, to lower the barrier to entry.
 * safe:  0.50 SOL, signals creator commitment.
 */
export const PLATFORM_FEE_LAMPORTS = {
  quick: 0n,
  safe:  500_000_000n,
};

// ── LP distribution (basis points, must sum to 10 000 per tier) ───────────────

/**
 * quick: 20% platform, 10% creator, 70% burned.
 * safe:  10% platform, 15% creator, 75% locked via Raydium's lock program.
 */
export const LP_SPLIT_BPS = {
  quick: { platform: 2000, creator: 1000, burned: 7000 },
  safe:  { platform: 1000, creator: 1500, locked: 7500 },
};

// ── Raydium CPMM swap fee rates ───────────────────────────────────────────────

/**
 * Charged on every trade in the CPMM pool.
 * Raydium's tradeFeeRate denominator is 1_000_000.
 */
export const SWAP_FEE_PCT  = { quick: 2, safe: 1 };
export const SWAP_FEE_RATE = { quick: 20_000, safe: 10_000 };

// ── Tier validation ───────────────────────────────────────────────────────────

export const VALID_TIERS = ['quick', 'safe'];
