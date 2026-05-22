import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { mint }                                    from '../token/src/index.js';
import { launch, ForgeValidationError, ForgePoolExistsError } from './src/index.js';

const RPC = 'https://api.devnet.solana.com';

// Load devnet secret from env var. Integration tests skip if unset.
const TEST_SECRET = process.env.FORGEKIT_DEVNET_SECRET;

// ── Helpers ──────────────────────────────────────────────────────────────────

function pass(label) { console.log(`  PASS  ${label}`); }
function fail(label, err) { console.error(`  FAIL  ${label}\n        ${err?.message ?? err}`); process.exitCode = 1; }

// ── Validation tests (no network) ────────────────────────────────────────────

function testValidation() {
  console.log('\nValidation');

  const key = Keypair.generate().secretKey;

  const cases = [
    ['rejects missing name',          () => launch(), ForgeValidationError],
    ['rejects non-string name',       () => launch(99), ForgeValidationError],
    ['rejects bad mint address',      () => launch('x').mint(123), ForgeValidationError],
    ['rejects bad decimals',          () => launch('x').mint('abc123abc123abc123abc123abc123ab').decimals(10), ForgeValidationError],
    ['rejects seed below minimum',    () => launch('x').mint('abc123abc123abc123abc123abc123ab').seed(0.3), ForgeValidationError],
    ['rejects seed of exactly 0',     () => launch('x').mint('abc123abc123abc123abc123abc123ab').seed(0), ForgeValidationError],
    ['rejects invalid fee tier',      () => launch('x').mint('abc123abc123abc123abc123abc123ab').feeTier(3), ForgeValidationError],
    ['rejects non-Uint8Array wallet', () => launch('x').mint('abc123abc123abc123abc123abc123ab').wallet('x'), ForgeValidationError],
    ['rejects bad rpc url',           () => launch('x').mint('abc123abc123abc123abc123abc123ab').rpc('nope'), ForgeValidationError],
    ['rejects send with no mint',     () => launch('x').wallet(key).seed(0.65).tokens(1).decimals(6).send(), ForgeValidationError],
    ['rejects send with no tokens',   () => launch('x').mint('abc123abc123abc123abc123abc123ab').decimals(6).seed(0.65).wallet(key).send(), ForgeValidationError],
    ['rejects send with no wallet',   () => launch('x').mint('abc123abc123abc123abc123abc123ab').decimals(6).tokens(1).seed(0.65).send(), ForgeValidationError],
  ];

  for (const [label, fn, ErrorClass] of cases) {
    try {
      const result = fn();
      if (result instanceof Promise) {
        result.catch(err => {
          if (err instanceof ErrorClass) pass(label);
          else fail(label, err);
        });
      } else {
        fail(label, new Error('Expected an error but none was thrown'));
      }
    } catch (err) {
      if (err instanceof ErrorClass) pass(label);
      else fail(label, err);
    }
  }
}

// ── Integration test (devnet) ─────────────────────────────────────────────────

async function testLaunchOnDevnet() {
  console.log('\nIntegration (devnet)');

  if (!TEST_SECRET) {
    console.log('  SKIP  Set FORGEKIT_DEVNET_SECRET to run on-chain tests.');
    return;
  }

  const keypair    = Keypair.fromSecretKey(bs58.decode(TEST_SECRET));
  const connection = new Connection(RPC, 'confirmed');

  console.log(`  Wallet  ${keypair.publicKey.toBase58()}`);

  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`  Balance ${(balance / 1e9).toFixed(4)} SOL`);

  if (balance < 0.8 * 1e9) {
    fail('sufficient devnet SOL (need ~0.8)', new Error(`only ${(balance / 1e9).toFixed(4)} SOL available`));
    return;
  }

  // ── 1. Mint a fresh token to use as pool base ──────────────────────────────
  console.log('\n  Step 1 Minting test token...');
  let mintResult;
  try {
    mintResult = await mint('launchpad-test-token')
      .supply(1_000_000_000)
      .decimals(6)
      .metadata({
        name:        'LaunchPad Test',
        symbol:      'LPT',
        uri:         'https://arweave.net/test',
      })
      .wallet(keypair.secretKey)
      .rpc(RPC)
      .send();

    pass('token minted for pool');
    console.log(`  Mint    ${mintResult.mintAddress}`);
  } catch (err) {
    fail('token minted for pool', err);
    return;
  }

  // ── 2. Launch the CPMM pool ────────────────────────────────────────────────
  console.log('\n  Step 2 Creating Raydium CPMM pool...');
  let poolResult;
  try {
    poolResult = await launch('launchpad-test-pool')
      .mint(mintResult.mintAddress)
      .decimals(6)
      .tokens(500_000_000)
      .seed(0.65)
      .feeTier(1)
      .wallet(keypair.secretKey)
      .rpc(RPC)
      .send();

    pass('pool created without error');
    console.log(`  Pool    ${poolResult.poolId}`);
    console.log(`  LP Mint ${poolResult.lpMint}`);
    console.log(`  Sig     ${poolResult.signature}`);
  } catch (err) {
    fail('pool created without error', err);
    return;
  }

  // ── 3. Verify pool exists on-chain ────────────────────────────────────────
  try {
    const poolAccount = await connection.getAccountInfo(new PublicKey(poolResult.poolId));
    if (poolAccount !== null) pass('pool account exists on-chain');
    else fail('pool account exists on-chain', new Error('getAccountInfo returned null'));
  } catch (err) {
    fail('pool account exists on-chain', err);
  }

  // ── 4. Return shape ───────────────────────────────────────────────────────
  if (poolResult.poolId   && typeof poolResult.poolId   === 'string') pass('returns poolId');
  else fail('returns poolId', new Error(`got: ${poolResult.poolId}`));

  if (poolResult.lpMint   && typeof poolResult.lpMint   === 'string') pass('returns lpMint');
  else fail('returns lpMint', new Error(`got: ${poolResult.lpMint}`));

  if (poolResult.signature && typeof poolResult.signature === 'string') pass('returns signature');
  else fail('returns signature', new Error(`got: ${poolResult.signature}`));

  // ── 5. Idempotency second launch must throw ForgePoolExistsError ─────────
  console.log('\n  Step 3 Testing idempotency...');
  try {
    await launch('launchpad-test-pool-retry')
      .mint(mintResult.mintAddress)
      .decimals(6)
      .tokens(500_000_000)
      .seed(0.65)
      .feeTier(1)
      .wallet(keypair.secretKey)
      .rpc(RPC)
      .send();

    fail('throws ForgePoolExistsError on duplicate pool', new Error('Expected error but none thrown'));
  } catch (err) {
    if (err instanceof ForgePoolExistsError && err.poolId === poolResult.poolId) {
      pass('throws ForgePoolExistsError on duplicate pool');
      pass('ForgePoolExistsError carries correct poolId');
    } else {
      fail('throws ForgePoolExistsError on duplicate pool', err);
    }
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

console.log('--- @forgekit-labs/launchpad ---');
testValidation();
await testLaunchOnDevnet();
console.log('\nDone.');