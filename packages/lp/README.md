# @forgekit/lp

LP token distribution after Raydium CPMM pool creation. Burn, lock, transfer. Individually or as a tier-aware pipeline.

## Install

```bash
npm install @forgekit/lp
```

## Usage

Use `liquidate` to run the full tier-aware flow:

```js
import { liquidate } from '@forgekit/lp';

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
import { distribute, lock, transfer } from '@forgekit/lp';
```

Every primitive is idempotent. If the operation has already run, `.send()` returns `{ alreadyDone: true }` without submitting a second transaction.

## Error Handling

```js
import { liquidate, ForgeTxError, ForgeRpcError } from '@forgekit/lp';

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
