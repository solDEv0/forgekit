# @forgekit-labs/fees

Launchpad fee schedule. Platform fees, LP splits, swap rates, and total payment amounts. Pure math, no network, zero third-party dependencies.

## Install

```bash
npm install @forgekit-labs/fees
```

## Usage

```js
import { fees } from '@forgekit-labs/fees';

const f = fees('my-launch')
  .tier('quick')
  .seed(0.65);

f.platform();      // 0n (free for quick tier)
f.total();         // 650_000_000n  (platform fee + LP seed, in lamports)
f.split(lpSupply); // { platform: bigint, creator: bigint, burned: bigint }
f.swapRate();      // { pct: 2, rate: 20_000 }
```

Safe tier:

```js
const f = fees('my-launch')
  .tier('safe')
  .seed(0.65);

f.platform();      // 500_000_000n  (0.50 SOL flat fee)
f.total();         // 1_150_000_000n
f.split(lpSupply); // { platform: bigint, creator: bigint, locked: bigint }
f.swapRate();      // { pct: 1, rate: 10_000 }
```

## Constants

Raw constants are also exported for when you just need the numbers:

```js
import {
  LP_SEED_MIN_LAMPORTS,
  PLATFORM_FEE_LAMPORTS,
  LP_SPLIT_BPS,
  SWAP_FEE_RATE,
} from '@forgekit-labs/fees';
```

## Error Handling

```js
import { fees, ForgeValidationError } from '@forgekit-labs/fees';

try {
  fees('my-launch').seed(0.3); // below 0.65 SOL minimum
} catch (err) {
  if (err instanceof ForgeValidationError) {
    console.error(err.message);
    console.error(err.hint); // tells you exactly what to do
  }
}
```

## License

MIT
