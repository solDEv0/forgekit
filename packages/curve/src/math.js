/**
 * Pure math utilities for bonding curve systems.
 * All functions are synchronous, zero-dependency, and BigInt-safe.
 */

/**
 * Convert lamports to a fixed-point SOL decimal string without touching
 * JavaScript's float. Avoids precision loss above ~9 000 SOL.
 *
 *   lamportsToSol(1_500_000_000n)     => "1.500000000"   (9 dp)
 *   lamportsToSol(1_500_000_000n, 4)  => "1.5000"
 *
 * @param {bigint|number|string} lamports
 * @param {number} [decimals=9]
 * @returns {string}
 */
export function lamportsToSol(lamports, decimals = 9) {
  const raw    = BigInt(lamports);
  const abs    = raw < 0n ? -raw : raw;
  const sign   = raw < 0n ? '-' : '';
  const str    = abs.toString().padStart(10, '0');
  const intPart  = str.slice(0, -9) || '0';
  const fracFull = str.slice(-9).padEnd(decimals, '0').slice(0, decimals);
  return `${sign}${intPart}.${fracFull}`;
}

/**
 * Convert a SOL amount (number or string) to lamports as a BigInt.
 *
 *   solToLamports(1.5)    => 1_500_000_000n
 *   solToLamports('0.65') => 650_000_000n
 *
 * @param {number|string} sol
 * @returns {bigint}
 */
export function solToLamports(sol) {
  return BigInt(Math.round(Number(sol) * 1_000_000_000));
}

/**
 * Compute the effective price per token from a confirmed trade.
 * Returns SOL per WHOLE token as a fixed-point decimal string.
 * Pass raw token units (from SPL balance) and the token's decimal places.
 *
 *   pricePerToken(650_000_000n, 1_000_000_000_000n, 6)
 *     => "0.000000650000000"  (0.65 SOL for 1M tokens at 6 dp)
 *
 * @param {bigint|string} solLamports      SOL spent or received (lamports)
 * @param {bigint|string} rawTokens        tokens bought/sold (raw base units)
 * @param {number}        [tokenDecimals]  token decimal places (default 6)
 * @param {number}        [precision]      decimal places in output (default 15)
 * @returns {string}                       SOL per whole token
 */
export function pricePerToken(solLamports, rawTokens, tokenDecimals = 6, precision = 15) {
  const sol    = BigInt(solLamports);
  const tokens = BigInt(rawTokens);
  if (tokens === 0n || sol === 0n) return '0';

  // Scale numerator by 10^precision to preserve sub-lamport precision.
  // Multiply by 10^decimals to undo the raw-to-whole conversion.
  const scale  = 10n ** BigInt(precision) * 10n ** BigInt(tokenDecimals);
  const scaled = sol * scale / (tokens * 1_000_000_000n);
  if (scaled === 0n) return '0';

  const str      = scaled.toString().padStart(precision + 1, '0');
  const intPart  = str.slice(0, -precision) || '0';
  const fracPart = str.slice(-precision);
  return `${intPart}.${fracPart}`;
}

/**
 * Compute the spot price from Raydium's pool reserves.
 * realB = SOL in pool (lamports), realA = tokens in pool (raw base units).
 * Returns SOL per whole token as a fixed-point decimal string.
 *
 * @param {bigint|string} realB            SOL reserves (lamports)
 * @param {bigint|string} realA            token reserves (raw base units)
 * @param {number}        [tokenDecimals]  token decimal places (default 6)
 * @param {number}        [precision]      decimal places in output (default 15)
 * @returns {string}                       SOL per whole token
 */
export function spotPrice(realB, realA, tokenDecimals = 6, precision = 15) {
  return pricePerToken(realB, realA, tokenDecimals, precision);
}

/**
 * Compute how far along the graduation threshold a curve has progressed.
 *
 * @param {bigint|string|number} raisedLamports     SOL raised so far
 * @param {bigint|string|number} thresholdLamports  graduation threshold
 * @returns {{ pct: number, remaining: bigint }}
 *   pct: 0 to 100 (capped), remaining: lamports left to graduation (0 if graduated)
 */
export function progress(raisedLamports, thresholdLamports) {
  const raised    = BigInt(raisedLamports);
  const threshold = BigInt(thresholdLamports);
  if (threshold === 0n) return { pct: 100, remaining: 0n };
  // Multiply by 10_000 first to preserve two decimal places in pct.
  const bps = raised * 10_000n / threshold;
  const pct = Math.min(Number(bps) / 100, 100);
  const remaining = raised >= threshold ? 0n : threshold - raised;
  return { pct, remaining };
}

/**
 * Compute the fully-diluted market cap in USD.
 * FDV = spotPrice (SOL/token) × totalSupply (whole tokens) × solPriceUsd (USD/SOL)
 *
 * @param {number} spotPriceSol  SOL per whole token
 * @param {number} totalSupply   total token supply in whole units
 * @param {number} solPriceUsd   current SOL/USD price
 * @returns {number}             USD market cap
 */
export function marketCap(spotPriceSol, totalSupply, solPriceUsd) {
  return spotPriceSol * totalSupply * solPriceUsd;
}

/**
 * Safe integer basis-point calculation using BigInt.
 *   basisOf(1_000_000n, 2000) => 200_000n  (20% of 1M)
 *
 * @param {bigint} total
 * @param {number} bps    10000 = 100%
 * @returns {bigint}
 */
export function basisOf(total, bps) {
  return (BigInt(total) * BigInt(bps)) / 10_000n;
}
