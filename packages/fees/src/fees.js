import { ForgeValidationError } from '@forgekit-labs/errors';
import {
  LP_SEED_MIN_SOL,
  PLATFORM_FEE_LAMPORTS,
  LP_SPLIT_BPS,
  SWAP_FEE_PCT,
  SWAP_FEE_RATE,
  VALID_TIERS,
} from './schedule.js';

function solToLamports(sol) {
  return BigInt(Math.round(Number(sol) * 1_000_000_000));
}

function basisOf(total, bps) {
  return (BigInt(total) * BigInt(bps)) / 10_000n;
}

class FeesBuilder {
  #name;
  #tier    = null;
  #seedSol = null;

  constructor(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ForgeValidationError(
        'fees() requires a name. Pass a string identifier.',
        'Example: fees("my-launch")',
      );
    }
    this.#name = name;
  }

  /**
   * Set the launch tier ('quick' or 'safe').
   * @param {'quick'|'safe'} tier
   */
  tier(tier) {
    if (!VALID_TIERS.includes(tier)) {
      throw new ForgeValidationError(
        `tier() received "${tier}". Must be one of: ${VALID_TIERS.join(', ')}.`,
        `Use fees("${this.#name}").tier("quick") or .tier("safe").`,
      );
    }
    this.#tier = tier;
    return this;
  }

  /**
   * Set the LP seed amount in SOL.
   * @param {number|string} sol
   */
  seed(sol) {
    const n = Number(sol);
    if (!Number.isFinite(n) || n <= 0) {
      throw new ForgeValidationError(
        `seed() received ${sol}. Must be a positive number.`,
        'Pass the LP seed in SOL, e.g. .seed(0.65).',
      );
    }
    if (n < LP_SEED_MIN_SOL) {
      throw new ForgeValidationError(
        `seed() received ${n} SOL. Below the minimum of ${LP_SEED_MIN_SOL} SOL.`,
        `Raydium CPMM requires at least ${LP_SEED_MIN_SOL} SOL: ` +
        `0.15 SOL is consumed as the pool creation fee, ` +
        `leaving 0.50 SOL as the minimum pool liquidity.`,
      );
    }
    this.#seedSol = n;
    return this;
  }

  // ── Computed values ───────────────────────────────────────────────────────

  /**
   * Platform flat fee for this tier, in lamports.
   * Quick = 0n, Safe = 500_000_000n.
   * @returns {bigint}
   */
  platform() {
    this.#requireTier('platform');
    return PLATFORM_FEE_LAMPORTS[this.#tier];
  }

  /**
   * Total lamports the creator must send: platform fee + LP seed.
   * Requires both .tier() and .seed() to be set.
   * @returns {bigint}
   */
  total() {
    this.#requireTier('total');
    this.#requireSeed('total');
    const seedLamports = solToLamports(this.#seedSol);
    return PLATFORM_FEE_LAMPORTS[this.#tier] + seedLamports;
  }

  /**
   * LP token split for the given total LP supply.
   *
   * Quick: { platform: bigint, creator: bigint, burned: bigint }
   * Safe:  { platform: bigint, creator: bigint, locked: bigint }
   *
   * All three parts sum to lpSupply. BigInt division floors;
   * the remainder is absorbed by the platform share.
   *
   * @param {bigint|number|string} lpSupply  total LP token supply
   * @returns {object}
   */
  split(lpSupply) {
    this.#requireTier('split');
    const supply = BigInt(lpSupply);
    if (supply <= 0n) {
      throw new ForgeValidationError(
        'split() received a zero or negative lpSupply.',
        'Pass the total LP token supply as a positive BigInt or number.',
      );
    }
    const bps = LP_SPLIT_BPS[this.#tier];
    if (this.#tier === 'quick') {
      const creator  = basisOf(supply, bps.creator);
      const burned   = basisOf(supply, bps.burned);
      const platform = supply - creator - burned;
      return { platform, creator, burned };
    }
    const creator  = basisOf(supply, bps.creator);
    const locked   = basisOf(supply, bps.locked);
    const platform = supply - creator - locked;
    return { platform, creator, locked };
  }

  /**
   * Raydium swap fee rate for this tier.
   *
   * Returns { pct, rate } where:
   *   pct  = human-readable percentage (2 or 1)
   *   rate = Raydium tradeFeeRate value (denominator: 1_000_000)
   *
   * @returns {{ pct: number, rate: number }}
   */
  swapRate() {
    this.#requireTier('swapRate');
    return {
      pct:  SWAP_FEE_PCT[this.#tier],
      rate: SWAP_FEE_RATE[this.#tier],
    };
  }

  // ── Private guards ────────────────────────────────────────────────────────

  #requireTier(method) {
    if (!this.#tier) {
      throw new ForgeValidationError(
        `${method}() called before .tier(). Tier is required.`,
        `Call .tier("quick") or .tier("safe") before .${method}().`,
      );
    }
  }

  #requireSeed(method) {
    if (this.#seedSol === null) {
      throw new ForgeValidationError(
        `${method}() called before .seed(). LP seed amount is required.`,
        `Call .seed(0.65) (or higher) before .${method}().`,
      );
    }
  }
}

export function fees(name) {
  return new FeesBuilder(name);
}
