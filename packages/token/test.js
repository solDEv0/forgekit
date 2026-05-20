import { Connection, Keypair } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import bs58 from 'bs58';
import { mint, ForgeValidationError } from './src/index.js';

const RPC      = 'https://api.devnet.solana.com';
const SUPPLY   = 1_000_000_000;
const DECIMALS = 6;

// Load devnet secret from env var. Integration tests skip if unset.
const TEST_SECRET = process.env.FORGEKIT_DEVNET_SECRET;

// ── Helpers ──────────────────────────────────────────────────────────────────

function pass(label) { console.log(`  PASS  ${label}`); }
function fail(label, err) { console.error(`  FAIL  ${label}\n        ${err?.message ?? err}`); process.exitCode = 1; }

// ── Validation tests (no network needed) ─────────────────────────────────────

function testValidation() {
  console.log('\nValidation');

  const cases = [
    ['rejects missing name',          () => mint(),                                         ForgeValidationError],
    ['rejects non-string name',       () => mint(42),                                        ForgeValidationError],
    ['rejects zero supply',           () => mint('x').supply(0),                             ForgeValidationError],
    ['rejects negative supply',       () => mint('x').supply(-1),                            ForgeValidationError],
    ['rejects decimals out of range', () => mint('x').supply(1).decimals(10),                ForgeValidationError],
    ['rejects burn over 50%',         () => mint('x').supply(1).burn(51),                    ForgeValidationError],
    ['rejects unknown authority',     () => mint('x').supply(1).revoke('update'),            ForgeValidationError],
    ['rejects non-Uint8Array wallet', () => mint('x').supply(1).wallet('bad'),               ForgeValidationError],
    ['rejects bad rpc url',           () => mint('x').supply(1).rpc('not-a-url'),            ForgeValidationError],
    ['rejects send with no supply',   () => mint('x').wallet(Keypair.generate().secretKey).send(), ForgeValidationError],
    ['rejects send with no wallet',   () => mint('x').supply(1).send(),                      ForgeValidationError],
  ];

  for (const [label, fn, ErrorClass] of cases) {
    try {
      const result = fn();
      // send() returns a Promisecatch async validation too
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

async function testMintOnDevnet() {
  console.log('\nIntegration (devnet)');

  if (!TEST_SECRET) {
    console.log('  SKIP  Set FORGEKIT_DEVNET_SECRET to run on-chain tests.');
    return;
  }

  const connection = new Connection(RPC, 'confirmed');
  const keypair    = Keypair.fromSecretKey(bs58.decode(TEST_SECRET));

  console.log(`  Wallet  ${keypair.publicKey.toBase58()}`);;

  // ── 1. Basic mint ──────────────────────────────────────────────────────────
  let result;
  try {
    result = await mint('forgekit-token-test')
      .supply(SUPPLY)
      .decimals(DECIMALS)
      .metadata({
        name:   'ForgeKit Token Test',
        symbol: 'FKT',
        uri:    'https://arweave.net/test',
      })
      .burn(2)
      .revoke('freeze')
      .revoke('mint')
      .wallet(keypair.secretKey)
      .rpc(RPC)
      .send();

    pass('mint() resolves without error');
  } catch (err) {
    fail('mint() resolves without error', err);
    return;
  }

  console.log(`  Mint    ${result.mintAddress}`);
  console.log(`  Sig     ${result.signature}`);

  // ── 2. Return shape ────────────────────────────────────────────────────────
  if (result.mintAddress && typeof result.mintAddress === 'string') pass('returns mintAddress');
  else fail('returns mintAddress', new Error(`got: ${result.mintAddress}`));

  if (result.signature && typeof result.signature === 'string') pass('returns signature');
  else fail('returns signature', new Error(`got: ${result.signature}`));

  // ── 3. Burn amount ─────────────────────────────────────────────────────────
  const rawSupply      = BigInt(SUPPLY) * BigInt(10 ** DECIMALS);
  const expectedBurned = (rawSupply * 200n) / 10_000n;
  if (BigInt(result.burned) === expectedBurned) pass('burned amount is correct (2% of supply)');
  else fail('burned amount is correct', new Error(`expected ${expectedBurned}, got ${result.burned}`));

  // ── 4. Revoked array ───────────────────────────────────────────────────────
  const revoked = result.revoked ?? [];
  if (revoked.includes('freeze') && revoked.includes('mint')) pass('revoked array contains freeze and mint');
  else fail('revoked array contains freeze and mint', new Error(`got: ${JSON.stringify(revoked)}`));

  // ── 5. On-chain verification ───────────────────────────────────────────────
  try {
    const { PublicKey } = await import('@solana/web3.js');
    const onChain = await getMint(connection, new PublicKey(result.mintAddress));

    if (onChain.freezeAuthority === null) pass('freeze authority is null on-chain');
    else fail('freeze authority is null on-chain', new Error(`got: ${onChain.freezeAuthority}`));

    if (onChain.mintAuthority === null) pass('mint authority is null on-chain');
    else fail('mint authority is null on-chain', new Error(`got: ${onChain.mintAuthority}`));

    const expectedSupply = rawSupply - expectedBurned;
    if (onChain.supply === expectedSupply) pass('on-chain supply matches (total minus burned)');
    else fail('on-chain supply matches', new Error(`expected ${expectedSupply}, got ${onChain.supply}`));
  } catch (err) {
    fail('on-chain verification', err);
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

console.log('--- @forgekit/token ---');
testValidation();
await testMintOnDevnet();
console.log('\nDone.');
