import { ForgeValidationError } from '@forgekit-labs/errors';
import { progress, marketCap } from './math.js';

/**
 * Bonding curve calculator.
 *
 * Configure shared parameters once (supply, solPrice), then call compute
 * methods to derive Raydium launchpad parameters and live display values.
 * All methods are synchronous. No network, no wallet required.
 *
 * Usage:
 *   const c = curve('my-token')
 *     .supply(980_000_000)
 *     .solPrice(180);
 *
 *   const mintInitPrice = c.startPrice(5_000);    // SOL/token for $5K MC
 *   const threshold     = c.graduationAt(50_000); // lamports as BigInt
 *   const { pct }       = c.progress(raised, threshold);
 *   const mcUsd         = c.marketCap(spotSol);
 */
class CurveCalculator {
  #name;
  #supply   = null;
  #decimals = 6;
  #solPrice = null;

  constructor(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ForgeValidationError(
        'curve() requires a name. Pass a string identifier.',
        'Example: curve("my-token")',
      );
    }
    this.#name = name;
  }

  /**
   * Total token supply in whole units (post-burn, post-dev-allocation).
   * For a bonding curve this is the tokens allocated to the curve.
   */
  supply(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      throw new ForgeValidationError(
        `supply() received ${amount}. Must be a positive number.`,
        'Pass the total token supply in whole units, not raw base units.',
      );
    }
    this.#supply = n;
    return this;
  }

  /** Token decimals. Defaults to 6 (Raydium launchpad standard). */
  decimals(d) {
    if (!Number.isInteger(d) || d < 0 || d > 18) {
      throw new ForgeValidationError(
        `decimals() received ${d}. Must be an integer between 0 and 18.`,
      );
    }
    this.#decimals = d;
    return this;
  }

  /**
   * Current SOL price in USD. Used for all MC-related calculations.
   * Fetch from your price oracle before calling.
   */
  solPrice(usd) {
    const n = Number(usd);
    if (!Number.isFinite(n) || n <= 0) {
      throw new ForgeValidationError(
        `solPrice() received ${usd}. Must be a positive number.`,
        'Pass the current SOL/USD price. Example: .solPrice(180)',
      );
    }
    this.#solPrice = n;
    return this;
  }

  // ── Compute methods ──────────────────────────────────────────────────────────

  /**
   * Compute mintInitPrice for Raydium's createLaunchpad.
   *   mintInitPrice = startMcUsd / totalSupply / solPriceUsd
   *
   * @param {number} startMcUsd  desired starting market cap in USD
   * @returns {number}  SOL per token (pass to Raydium's createLaunchpad)
   */
  startPrice(startMcUsd) {
    this.#requireSupply('startPrice');
    this.#requireSolPrice('startPrice');
    if (!Number.isFinite(Number(startMcUsd)) || Number(startMcUsd) <= 0) {
      throw new ForgeValidationError(
        `startPrice() received ${startMcUsd}. Must be a positive number.`,
        'Pass the desired starting market cap in USD. Example: .startPrice(5_000)',
      );
    }
    return Number(startMcUsd) / this.#supply / this.#solPrice;
  }

  /**
   * Compute the graduation threshold in lamports.
   *   threshold = gradMcUsd / solPriceUsd (in SOL) × 1e9 (in lamports)
   *
   * Pass the result to Raydium's createLaunchpad as totalFundRaisingB.
   * When the pool accumulates this many lamports it automatically migrates
   * to a CPMM pool.
   *
   * @param {number} gradMcUsd  target graduation market cap in USD
   * @returns {bigint}  SOL threshold in lamports
   */
  graduationAt(gradMcUsd) {
    this.#requireSolPrice('graduationAt');
    if (!Number.isFinite(Number(gradMcUsd)) || Number(gradMcUsd) <= 0) {
      throw new ForgeValidationError(
        `graduationAt() received ${gradMcUsd}. Must be a positive number.`,
        'Pass the target graduation market cap in USD. Example: .graduationAt(50_000)',
      );
    }
    const solNeeded = Number(gradMcUsd) / this.#solPrice;
    return BigInt(Math.round(solNeeded * 1_000_000_000));
  }

  /**
   * Compute curve progress toward graduation.
   *
   * @param {bigint|string|number} raisedLamports     SOL raised so far
   * @param {bigint|string|number} thresholdLamports  graduation threshold (from graduationAt)
   * @returns {{ pct: number, remaining: bigint }}
   *   pct:       0 to 100, two decimal places of precision
   *   remaining: lamports left until graduation (0 once graduated)
   */
  progress(raisedLamports, thresholdLamports) {
    if (raisedLamports === undefined || raisedLamports === null) {
      throw new ForgeValidationError(
        'progress() requires raisedLamports as the first argument.',
      );
    }
    if (thresholdLamports === undefined || thresholdLamports === null) {
      throw new ForgeValidationError(
        'progress() requires thresholdLamports as the second argument.',
        'Pass the value returned by .graduationAt(gradMcUsd).',
      );
    }
    return progress(raisedLamports, thresholdLamports);
  }

  /**
   * Compute the fully-diluted market cap in USD.
   *   FDV = spotPrice (SOL/token) × totalSupply × solPriceUsd
   *
   * @param {number} spotPriceSol  current SOL-per-token price (from spotPrice() utility)
   * @returns {number}  USD market cap
   */
  marketCap(spotPriceSol) {
    this.#requireSupply('marketCap');
    this.#requireSolPrice('marketCap');
    const price = Number(spotPriceSol);
    if (!Number.isFinite(price) || price < 0) {
      throw new ForgeValidationError(
        `marketCap() received spotPriceSol=${spotPriceSol}. Must be a non-negative number.`,
        'Pass the spot price in SOL per token, e.g. from spotPrice(realB, realA).',
      );
    }
    return marketCap(price, this.#supply, this.#solPrice);
  }

  // ── Private guards ───────────────────────────────────────────────────────────

  #requireSupply(method) {
    if (this.#supply === null) {
      throw new ForgeValidationError(
        `${method}() requires a token supply. Call .supply(amount) first.`,
      );
    }
  }

  #requireSolPrice(method) {
    if (this.#solPrice === null) {
      throw new ForgeValidationError(
        `${method}() requires the SOL price. Call .solPrice(usd) first.`,
        'Fetch the current SOL/USD price from your price oracle before calling.',
      );
    }
  }
}

export function curve(name) {
  return new CurveCalculator(name);
}
