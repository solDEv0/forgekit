# @forgekit/pay

Build and verify SOL payment transactions. Unsigned v0 tx for frontend signing, on-chain verification with exact-amount and sender checks.

## Install

```bash
npm install @forgekit/pay
```

## Usage

Build an unsigned payment transaction for the frontend to sign:

```js
import { pay } from '@forgekit/pay';

const { transaction, blockhash, lastValidBlockHeight } = await pay('my-launch-fee')
  .from('3kYxg...')
  .to('BkbGa...')
  .amount(650_000_000n)
  .rpc('https://api.mainnet-beta.solana.com')
  .build();
```

Verify the payment landed on-chain with the right sender, recipient, and amount:

```js
import { verify } from '@forgekit/pay';

const { slot } = await verify('my-launch-fee')
  .signature('2dZUE...')
  .sender('3kYxg...')
  .recipient('BkbGa...')
  .amount(650_000_000n)
  .rpc('https://api.mainnet-beta.solana.com')
  .confirm();
```

`verify` retries until the transaction finalises (8 attempts on mainnet, 3 on devnet), then asserts source, destination, and lamport amount all match.

## Error Handling

```js
import { verify, ForgePaymentError, ForgeRpcError } from '@forgekit/pay';

try {
  await verify('my-launch-fee')
    .signature(sig)
    .sender(payer)
    .recipient(platform)
    .amount(expected)
    .confirm();
} catch (err) {
  if (err instanceof ForgePaymentError) {
    // sender mismatch, amount mismatch, recipient mismatch, or reverted tx
    console.error(err.message, err.hint);
  }
  if (err.retry) {
    // RPC issue, safe to retry
  }
}
```

## License

MIT
