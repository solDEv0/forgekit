# @forgekit/launchpad

Create Raydium CPMM liquidity pools in one call. Validation, idempotency, and fee config included.

## Install

```bash
npm install @forgekit/launchpad
```

## Usage

```js
import { launch } from '@forgekit/launchpad';

const { poolId, lpMint, signature } = await launch('my-pool')
  .mint('J1rNqz1...')
  .decimals(6)
  .tokens(500_000_000)
  .seed(0.65)
  .feeTier(1)
  .wallet(keypair.secretKey)
  .rpc('https://api.mainnet-beta.solana.com')
  .send();
```

Mainnet and devnet are auto-detected from the RPC URL. Program IDs and fee configs switch automatically.

`seed()` enforces the 0.65 SOL minimum: 0.15 SOL is consumed by Raydium as the pool creation fee, leaving 0.50 SOL as the minimum pool liquidity. Anything below this is rejected by Raydium on-chain with no useful error message, so it is caught synchronously before the network call.

## Idempotency

The Raydium pool PDA is deterministic. If a pool for this token already exists, `.send()` throws `ForgePoolExistsError` with the existing `poolId` attached:

```js
import { launch, ForgePoolExistsError } from '@forgekit/launchpad';

try {
  await launch('my-pool').mint(mint).decimals(6).tokens(500_000_000).seed(0.65).wallet(secretKey).send();
} catch (err) {
  if (err instanceof ForgePoolExistsError) {
    console.log('Pool already exists:', err.poolId);
  }
}
```

## Error Handling

```js
import { launch, ForgeTxError, ForgeRpcError } from '@forgekit/launchpad';

try {
  await launch('my-pool')./* ... */.send();
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
