// Raydium CPMM fee config accounts. Stable on-chain addresses.
// Hardcoded to avoid an API round-trip on every launch and remove
// an external dependency from the critical path.
//
// tradeFeeRate denominator: 1,000,000
//   10_000 = 1%
//   20_000 = 2%
//
// createPoolFee: 150_000_000 lamports = 0.15 SOL (paid to Raydium at creation)
//
// Devnet has no 2% config. Both tiers fall back to 1% (index 3).

export const CPMM_FEE_CONFIGS = {
  mainnet: {
    1: {
      id:              'G95xxie3XbkCqtE39GgQ9Ggc7xBC8Uceve7HFDEFApkc',
      index:           1,
      protocolFeeRate: 120_000,
      tradeFeeRate:    10_000,
      fundFeeRate:     40_000,
      createPoolFee:   '150000000',
      creatorFeeRate:  500,
    },
    2: {
      id:              '2fGXL8uhqxJ4tpgtosHZXT4zcQap6j62z3bMDxdkMvy5',
      index:           2,
      protocolFeeRate: 120_000,
      tradeFeeRate:    20_000,
      fundFeeRate:     40_000,
      createPoolFee:   '150000000',
      creatorFeeRate:  500,
    },
  },
  devnet: {
    1: {
      id:              'EsTevfacYXpuho5VBuzBjDZi8dtWidGnXoSYAr8krTvz',
      index:           3,
      protocolFeeRate: 120_000,
      tradeFeeRate:    10_000,
      fundFeeRate:     40_000,
      createPoolFee:   '150000000',
      creatorFeeRate:  2_500,
    },
    2: {
      id:              'EsTevfacYXpuho5VBuzBjDZi8dtWidGnXoSYAr8krTvz',
      index:           3,
      protocolFeeRate: 120_000,
      tradeFeeRate:    10_000,
      fundFeeRate:     40_000,
      createPoolFee:   '150000000',
      creatorFeeRate:  2_500,
    },
  },
};

export const VALID_FEE_TIERS = new Set([1, 2]);

// 0.15 SOL creation fee + 0.50 SOL minimum pool liquidity
export const MIN_SEED_SOL    = 0.65;
export const MIN_SEED_LAMPORTS = BigInt(650_000_000);

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
