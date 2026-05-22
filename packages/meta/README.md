# @forgekit-labs/meta

Upload token and NFT metadata to Arweave via Turbo. One call, permanent storage.

## Install

```bash
npm install @forgekit-labs/meta
```

## Usage

```js
import { cast } from '@forgekit-labs/meta';

const { uri } = await cast('my-token')
  .image('./logo.png')
  .describe({ name: 'MY TOKEN', symbol: 'MTK', description: 'Built different.' })
  .attributes([{ trait_type: 'Tier', value: 'Quick' }])
  .deploy();

console.log(uri); // https://arweave.net/...
```

## Where this runs

`@forgekit-labs/meta` runs server-side. The wallet you pass to `.wallet()` authenticates the Turbo upload, so it should be your own platform wallet, running in your backend. It is not a browser package, and it should never receive an end user's personal key. In a launchpad, end users sign only their own payment, through `@forgekit-labs/pay`.

## Error Handling

```js
import { cast, ForgeUploadError, ForgeBalanceError } from '@forgekit-labs/meta';

try {
  const { uri } = await cast('my-token').image('./logo.png').describe({...}).deploy();
} catch (err) {
  if (err instanceof ForgeBalanceError) {
    console.error(err.hint); // tells you exactly what to do
  }
  if (err.retry) {
    // safe to retry
  }
}
```

## License

MIT
