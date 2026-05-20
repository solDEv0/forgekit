# @forgekit/token

Mint Solana tokens with authority revocations and burn in one atomic transaction.

## Install

```bash
npm install @forgekit/token
```

## Usage

```js
import { mint } from '@forgekit/token';

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

## Error Handling

```js
import { mint, ForgeTxError, ForgeRpcError } from '@forgekit/token';

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
