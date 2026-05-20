# @forgekit/curve

Bonding curve math. Starting price, graduation threshold, progress, market cap. Pure functions, no network, zero third-party dependencies.

## Install

```bash
npm install @forgekit/curve
```

## Usage

```js
import { curve } from '@forgekit/curve';

const c = curve('my-token')
  .supply(980_000_000)
  .solPrice(180);

c.startPrice(5_000);                  // SOL/token for $5K starting MC
c.graduationAt(50_000);               // lamports needed to graduate at $50K
c.progress(raised, threshold);        // { pct, remaining }
c.marketCap(spotPriceSol);            // USD market cap
```

## Utilities

Standalone helpers for the cases where you do not need the builder:

```js
import {
  lamportsToSol,
  solToLamports,
  pricePerToken,
  spotPrice,
  progress,
  marketCap,
  basisOf,
} from '@forgekit/curve';
```

All utilities are BigInt-safe and return strings for amounts above the JavaScript float limit.

## Error Handling

```js
import { curve, ForgeValidationError } from '@forgekit/curve';

try {
  curve('my-token').supply(-1);
} catch (err) {
  if (err instanceof ForgeValidationError) {
    console.error(err.message);
    console.error(err.hint);
  }
}
```

## License

MIT
