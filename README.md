# forgekit

A precision toolkit for engineers building token launchpads, metadata pipelines, and onchain systems on Solana.

Every package follows the same shape: a verb-named entry point (`cast`, `mint`, `launch`, `pay`, `curve`, `fees`...), a fluent builder that validates as you go, and a single async terminal method. Validation happens synchronously before any network call. Errors carry a `code`, a plain-English `message`, an actionable `hint`, the original `cause`, and a `retry` flag.

Built from production experience. Every sharp edge in here was discovered the hard way.

## Packages

| Package | Description |
|---|---|
| [`@forgekit-labs/errors`](./packages/errors) | Canonical error classes shared across the toolkit |
| [`@forgekit-labs/meta`](./packages/meta) | Upload token and NFT metadata to Arweave via Turbo |
| [`@forgekit-labs/token`](./packages/token) | Mint Solana tokens with burn and authority revocations |
| [`@forgekit-labs/launchpad`](./packages/launchpad) | Create Raydium CPMM liquidity pools |
| [`@forgekit-labs/lp`](./packages/lp) | Distribute, lock, and transfer LP tokens after pool creation |
| [`@forgekit-labs/pay`](./packages/pay) | Build and verify SOL payment transactions |
| [`@forgekit-labs/curve`](./packages/curve) | Bonding curve math: start price, graduation, progress, market cap |
| [`@forgekit-labs/fees`](./packages/fees) | Fee schedule: platform fees, LP splits, swap rates |

## Quickstart

A full launch pipeline composing three packages:

```js
import { cast }   from '@forgekit-labs/meta';
import { mint }   from '@forgekit-labs/token';
import { launch } from '@forgekit-labs/launchpad';

// 1. Upload metadata to Arweave
const { uri } = await cast('my-token')
  .image('./logo.png')
  .describe({ name: 'MY TOKEN', symbol: 'MTK', description: 'Built different.' })
  .wallet(keypair.secretKey)
  .deploy();

// 2. Mint the token, burn 2%, revoke authorities, all in one atomic tx
const { mintAddress } = await mint('my-token')
  .supply(1_000_000_000)
  .decimals(6)
  .metadata({ name: 'MY TOKEN', symbol: 'MTK', uri })
  .burn(2)
  .revoke('freeze').revoke('mint')
  .wallet(keypair.secretKey)
  .send();

// 3. Launch a Raydium CPMM pool
const { poolId, lpMint } = await launch('my-pool')
  .mint(mintAddress)
  .decimals(6)
  .tokens(500_000_000)
  .seed(0.65)
  .feeTier(1)
  .wallet(keypair.secretKey)
  .send();
```

Every package is independently installable. Pick only what you need.

## Design

### The entry point is a verb

Every package exports a single named function that reads like an action:

```js
cast('my-token')        // @forgekit-labs/meta
mint('my-token')        // @forgekit-labs/token
launch('my-pool')       // @forgekit-labs/launchpad
liquidate('my-pool')    // @forgekit-labs/lp
pay('my-launch-fee')    // @forgekit-labs/pay
verify('my-launch-fee') // @forgekit-labs/pay
curve('my-token')       // @forgekit-labs/curve
fees('my-launch')       // @forgekit-labs/fees
```

The argument is always a name. A human identifier for what you are building. It anchors the intent before anything else is configured.

### Fluent builder, reads like a sentence

Every method returns `this`. The chain describes what you want, not how to achieve it. The final method (`.deploy()`, `.send()`, `.build()`, `.confirm()`) is the only async call. Everything before it is pure configuration.

### Validation happens before the network

Every method validates its input immediately and throws synchronously if something is wrong. By the time the terminal call is reached, the builder is already in a valid state.

```js
.seed(0.3)
// throws ForgeValidationError immediately:
// "seed() received 0.3 SOL. Below the minimum of 0.65 SOL."
// hint: "Raydium CPMM requires at least 0.65 SOL: 0.15 SOL is consumed as the
//        pool creation fee, leaving 0.50 SOL as the minimum pool liquidity."
```

### Errors carry intent

No raw stack traces. Every error has:

| Field | Purpose |
|---|---|
| `code` | Machine-readable string, e.g. `VALIDATION_ERROR`, `TX_FAILED` |
| `message` | Human-readable, plain English, no jargon |
| `hint` | Tells the developer exactly what to do next |
| `cause` | The original error, if one exists |
| `retry` | Boolean. Safe to retry this operation? |

Error classes are shared across the toolkit via `@forgekit-labs/errors`. Branch on `err.code` (or `err.name`) for cross-package safety.

### Production knowledge baked in

The validation and defaults reflect real production failures, not documentation guesses:

- **Raydium CPMM seed minimum**: 0.65 SOL (0.15 SOL creation fee + 0.50 SOL minimum liquidity). Anything below this is rejected on-chain with `InstructionError [2, { Custom: 1 }]`. The error message tells you exactly why.
- **Fee configs hardcoded**: Raydium CPMM fee config addresses are stable on-chain accounts. Hardcoding them avoids an API round-trip on every launch and removes an external dependency from the critical path.
- **Devnet / mainnet auto-detected**: pass your RPC URL once. The SDK, program IDs, and fee configs all switch automatically.
- **Idempotency on pool creation**: the Raydium pool PDA is deterministic. If it already exists, `ForgePoolExistsError` is thrown with the existing `poolId`. No silent double-submit.
- **Authority revocation order**: freeze authority is always revoked before mint authority. Reversing this can leave a token in an inconsistent state.

### One atomic transaction

Where possible, everything happens in a single VersionedTransaction (V0). `@forgekit-labs/token` mints the full supply, burns the configured percentage, and revokes authorities all in one transaction. Either everything succeeds or nothing does.

### Private fields, no leaking state

Every builder uses JavaScript private class fields (`#field`). The internal state of a builder is never accessible from outside. You configure it through the public API or not at all.

## Verified on chain

Every package has been tested against real networks, not mocks.

| Package | Tests | Verified |
|---|---|---|
| `@forgekit-labs/meta` | 2 uploads | Arweave |
| `@forgekit-labs/token` | 16 | Devnet mint, burn, authority revocation |
| `@forgekit-labs/launchpad` | 20 | Devnet CPMM pool creation, idempotency |
| `@forgekit-labs/lp` | 31 | Devnet distribute, lock, transfer |
| `@forgekit-labs/pay` | 21 | Devnet build, sign, broadcast, verify |
| `@forgekit-labs/curve` | 57 | Pure math, BigInt-safe |
| `@forgekit-labs/fees` | 57 | Pure math |

## Running tests

Pure math tests run with no setup:

```bash
node packages/fees/test.js
node packages/curve/test.js
```

Integration tests require a funded devnet wallet:

```bash
export FORGEKIT_DEVNET_SECRET=<base58 secret key>
node packages/token/test.js
node packages/launchpad/test.js
node packages/lp/test.js
node packages/pay/test.js
```

If `FORGEKIT_DEVNET_SECRET` is unset, the integration portion of each suite skips with a clear message. Validation tests always run.

## Requirements

Node.js 18 or newer. All packages are ESM.

## License

MIT
