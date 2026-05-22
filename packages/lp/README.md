# @forgekit-labs/lp

LP token distribution after Raydium CPMM pool creation. Burn, lock, transfer. Individually or as a tier-aware pipeline.

## Install

```bash
npm install @forgekit-labs/lp
```

## Usage

Use `liquidate` to run the full tier-aware flow:

```js
import { liquidate } from '@forgekit-labs/lp';

// Quick tier: burn 70%, transfer 10% to creator, keep 20% as platform
const { distribute } = await liquidate('my-pool')
  .tier('quick')
  .lpMint('7ruhGTX2...')
  .supply(lpTotalSupply)
  .creator('3kYxg...')
  .wallet(keypair.secretKey)
  .rpc('https://api.mainnet-beta.solana.com')
  .send();

// Safe tier: lock 75%, transfer 15% to creator, keep 10% as platform
const { lock, transfer } = await liquidate('my-pool')
  .tier('safe')
  .lpMint('7ruhGTX2...')
  .poolId('EZDmpJ...')
  .creator('3kYxg...')
  .wallet(keypair.secretKey)
  .rpc('https://api.mainnet-beta.solana.com')
  .send();
```

Or call the primitives directly:

```js
import { distribute, lock, transfer } from '@forgekit-labs/lp';
```

Every primitive is idempotent. If the operation has already run, `.send()` returns `{ alreadyDone: true }` without submitting a second transaction.

## Where this runs

`@forgekit-labs/lp` runs server-side. The wallet you pass to `.wallet()` signs the LP transactions, so it should be your own platform wallet, running in your backend. It is not a browser package, and it should never receive an end user's personal key. In a launchpad, end users sign only their own payment, through `@forgekit-labs/pay`.

## Error Handling

```js
import { liquidate, ForgeTxError, ForgeRpcError } from '@forgekit-labs/lp';

try {
  await liquidate('my-pool').tier('quick').lpMint(mint).creator(wallet).wallet(secretKey).send();
} catch (err) {
  if (err instanceof ForgeTxError) {
    console.error(err.message, err.cause);
  }
  if (err.retry) {
    // safe to retry
  }
}
```

## License

MIT
