import { Keypair } from '@solana/web3.js';
import { cast }    from './src/index.js';

// Minimal 1x1 PNG pixelvalid PNG, 68 bytes, well under the 100 KB free tier limit
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ' +
  'AABjkB6QAAAABJRU5ErkJggg==',
  'base64',
);

// Throwaway keypairfree tier uploads under 100 KB need no SOL balance
const keypair = Keypair.generate();
console.log('Wallet:', keypair.publicKey.toBase58());
console.log('Casting test token metadata to Arweave...\n');

try {
  const { uri, image } = await cast('forgekit-test')
    .image(PIXEL_PNG)
    .describe({
      name:        'ForgeKit Test',
      symbol:      'FKT',
      description: 'A test upload from @forgekit-labs/meta.',
    })
    .attributes([
      { trait_type: 'Environment', value: 'Test'  },
      { trait_type: 'Version',     value: '0.1.0' },
    ])
    .wallet(keypair.secretKey)
    .deploy();

  console.log('Image URI:   ', image);
  console.log('Metadata URI:', uri);
  console.log('\nDone. Open the metadata URI in a browser to verify.');
} catch (err) {
  console.error(`\n[${err.code ?? err.name}] ${err.message}`);
  if (err.hint)  console.error('Hint:', err.hint);
  if (err.retry) console.error('This error is retryable.');
  process.exit(1);
}
