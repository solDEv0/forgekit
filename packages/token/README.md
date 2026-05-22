# @forgekit-labs/token

Mint Solana tokens with authority revocations and burn in one atomic transaction.

## Install

```bash
npm install @forgekit-labs/token
```

## Usage

```js
import { mint } from '@forgekit-labs/token';

const { signature, mintAddress, supply, burned, revoked } = await mint('my-token')
  .supply(1_000_000_000)
  .decimals(6)
  .metadata({ name: 'MY TOKEN', symbol: 'MTK', uri: metadataUri })
  .burn(2)
  .revoke('freeze')
  .revoke('mint')
  .wallet(keypair.secretKey)
  .rpc('https://api.mainnet-beta.solana.com')
  .send();
```

Everything happens in a single VersionedTransaction (V0): account creation, mint, ATA setup, full-supply mint, burn, and authority revocations. Either it all lands or none of it does.

Authority revocation order is fixed: freeze is always revoked before mint. Reversing the order can leave a token in an inconsistent state.

## Where this runs

`@forgekit-labs/token` runs server-side. The wallet you pass to `.wallet()` signs the mint transaction, so it should be your own platform wallet, running in your backend. It is not a browser package, and it should never receive an end user's personal key. In a launchpad, end users sign only their own payment, through `@forgekit-labs/pay`.

## Error Handling

```js
import { mint, ForgeTxError, ForgeRpcError } from '@forgekit-labs/token';

try {
  await mint('my-token').supply(1_000_000_000).wallet(secretKey).send();
} catch (err) {
  if (err instanceof ForgeTxError) {
    // transaction failed on-chain
    console.error(err.message, err.cause);
  }
  if (err.retry) {
    // RPC or network issue, safe to retry
  }
}
```

## License

MIT
