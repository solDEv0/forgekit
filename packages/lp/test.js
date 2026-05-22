import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58                              from 'bs58';
import { mint }                          from '../token/src/index.js';
import { launch }                        from '../launchpad/src/index.js';
import {
  distribute,
  lock,
  transfer,
  liquidate,
  ForgeValidationError,
} from './src/index.js';

const RPC = 'https://api.devnet.solana.com';

// Load devnet secret from env var. Integration tests skip if unset.
const TEST_SECRET = process.env.FORGEKIT_DEVNET_SECRET;

function pass(label) { console.log(`  PASS  ${label}`); }
function fail(label, err) { console.error(`  FAIL  ${label}\n        ${err?.message ?? err}`); process.exitCode = 1; }

// ── Validation tests (no network) ────────────────────────────────────────────

function testValidation() {
  console.log('\nValidationdistribute()');

  const key    = Keypair.generate().secretKey;
  const mint32 = 'abc123abc123abc123abc123abc123ab';

  const distributeCases = [
    ['rejects missing name',          () => distribute(),                                                                           ForgeValidationError],
    ['rejects non-string name',       () => distribute(99),                                                                         ForgeValidationError],
    ['rejects bad lpMint',            () => distribute('x').lpMint(123),                                                            ForgeValidationError],
    ['rejects invalid lpMint pubkey', () => distribute('x').lpMint('notakey'),                                                      ForgeValidationError],
    ['rejects bad supply',            () => distribute('x').lpMint(mint32).supply('abc'),                                           ForgeValidationError],
    ['rejects zero supply',           () => distribute('x').lpMint(mint32).supply('0'),                                             ForgeValidationError],
    ['rejects bad platform bps',      () => distribute('x').lpMint(mint32).supply('1000').platform(10001),                          ForgeValidationError],
    ['rejects bad creator bps',       () => distribute('x').lpMint(mint32).supply('1000').platform(2000).creator(10001, mint32),    ForgeValidationError],
    ['rejects bad creator wallet',    () => distribute('x').lpMint(mint32).supply('1000').platform(2000).creator(1000, 'notakey'),  ForgeValidationError],
    ['rejects non-Uint8Array wallet', () => distribute('x').lpMint(mint32).supply('1000').platform(2000).wallet('str'),            ForgeValidationError],
    ['rejects bad rpc url',           () => distribute('x').lpMint(mint32).supply('1000').platform(2000).wallet(key).rpc('nope'),  ForgeValidationError],
  ];

  runCases(distributeCases);

  console.log('\nValidationlock()');

  const lockCases = [
    ['rejects missing name',          () => lock(),                                                                     ForgeValidationError],
    ['rejects bad poolId',            () => lock('x').poolId('notakey'),                                                ForgeValidationError],
    ['rejects bad lpMint',            () => lock('x').poolId(mint32).lpMint('notakey'),                                 ForgeValidationError],
    ['rejects basis out of range',    () => lock('x').poolId(mint32).lpMint(mint32).basis(0),                           ForgeValidationError],
    ['rejects non-Uint8Array wallet', () => lock('x').poolId(mint32).lpMint(mint32).basis(7500).wallet('str'),          ForgeValidationError],
    ['rejects bad rpc url',           () => lock('x').poolId(mint32).lpMint(mint32).basis(7500).wallet(key).rpc('no'), ForgeValidationError],
  ];

  runCases(lockCases);

  console.log('\nValidationtransfer()');

  const transferCases = [
    ['rejects missing name',          () => transfer(),                                                                                  ForgeValidationError],
    ['rejects bad lpMint',            () => transfer('x').lpMint('notakey'),                                                             ForgeValidationError],
    ['rejects bad platform bps',      () => transfer('x').lpMint(mint32).platform(-1),                                                   ForgeValidationError],
    ['rejects bad creator bps',       () => transfer('x').lpMint(mint32).platform(1000).creator(0, mint32),                              ForgeValidationError],
    ['rejects bad creator wallet',    () => transfer('x').lpMint(mint32).platform(1000).creator(1500, 'notakey'),                        ForgeValidationError],
    ['rejects non-Uint8Array wallet', () => transfer('x').lpMint(mint32).platform(1000).creator(1500, mint32).wallet('str'),             ForgeValidationError],
    ['rejects bad rpc url',           () => transfer('x').lpMint(mint32).platform(1000).creator(1500, mint32).wallet(key).rpc('nope'),   ForgeValidationError],
  ];

  runCases(transferCases);

  console.log('\nValidationliquidate()');

  const liquidateCases = [
    ['rejects missing name',              () => liquidate(),                                                                                      ForgeValidationError],
    ['rejects bad tier',                  () => liquidate('x').tier('ultra'),                                                                     ForgeValidationError],
    ['rejects send with no tier',         () => liquidate('x').lpMint(mint32).creator(mint32).wallet(key).send(),                                ForgeValidationError],
    ['rejects send with no lpMint',       () => liquidate('x').tier('quick').creator(mint32).wallet(key).supply('1000').send(),                  ForgeValidationError],
    ['rejects send with no creator',      () => liquidate('x').tier('quick').lpMint(mint32).wallet(key).supply('1000').send(),                   ForgeValidationError],
    ['rejects send with no wallet',       () => liquidate('x').tier('quick').lpMint(mint32).creator(mint32).supply('1000').send(),               ForgeValidationError],
    ['quick tier requires supply',        () => liquidate('x').tier('quick').lpMint(mint32).creator(mint32).wallet(key).send(),                  ForgeValidationError],
    ['safe tier requires poolId',         () => liquidate('x').tier('safe').lpMint(mint32).creator(mint32).wallet(key).send(),                   ForgeValidationError],
  ];

  runCases(liquidateCases);
}

function runCases(cases) {
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

async function testLiquidateOnDevnet() {
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

  if (balance < 0.9 * 1e9) {
    fail('sufficient devnet SOL (need ~0.9)', new Error(`only ${(balance / 1e9).toFixed(4)} SOL available`));
    return;
  }

  // ── 1. Mint a fresh token ──────────────────────────────────────────────────
  console.log('\n  Step 1Minting test token...');
  let mintResult;
  try {
    mintResult = await mint('lp-test-token')
      .supply(1_000_000_000)
      .decimals(6)
      .metadata({ name: 'LP Test', symbol: 'LPT', uri: 'https://arweave.net/test' })
      .wallet(keypair.secretKey)
      .rpc(RPC)
      .send();

    pass('token minted for pool');
    console.log(`  Mint    ${mintResult.mintAddress}`);
  } catch (err) {
    fail('token minted for pool', err);
    return;
  }

  // ── 2. Create the pool ────────────────────────────────────────────────────
  console.log('\n  Step 2Creating Raydium CPMM pool...');
  let poolResult;
  try {
    poolResult = await launch('lp-test-pool')
      .mint(mintResult.mintAddress)
      .decimals(6)
      .tokens(500_000_000)
      .seed(0.65)
      .feeTier(1)
      .wallet(keypair.secretKey)
      .rpc(RPC)
      .send();

    pass('pool created');
    console.log(`  Pool    ${poolResult.poolId}`);
    console.log(`  LP Mint ${poolResult.lpMint}`);
  } catch (err) {
    fail('pool created', err);
    return;
  }

  // ── 3. Fetch LP mint total supply (before any distribution) ───────────────
  console.log('\n  Step 3Fetching LP mint supply...');
  let lpSupply;
  try {
    const supplyInfo = await connection.getTokenSupply(new PublicKey(poolResult.lpMint));
    lpSupply = supplyInfo.value.amount;
    pass('LP mint supply fetched');
    console.log(`  Supply  ${lpSupply}`);
  } catch (err) {
    fail('LP mint supply fetched', err);
    return;
  }

  // ── 4. liquidate()quick tier ───────────────────────────────────────────
  // Use a throwaway creator keypairplatform and creator must be different
  // wallets or the 10% "transfer" is a no-op (same ATA), breaking idempotency.
  const creatorKeypair = Keypair.generate();
  console.log(`  Creator ${creatorKeypair.publicKey.toBase58()}`);

  console.log('\n  Step 4Running liquidate() quick tier...');
  let liquidateResult;
  try {
    liquidateResult = await liquidate('lp-test-quick')
      .tier('quick')
      .lpMint(poolResult.lpMint)
      .supply(lpSupply)
      .creator(creatorKeypair.publicKey.toBase58())
      .wallet(keypair.secretKey)
      .rpc(RPC)
      .send();

    pass('liquidate quick completed without error');
    console.log(`  Sig     ${liquidateResult.distribute.signature}`);
    console.log(`  Burned  ${liquidateResult.distribute.burnedAmount}`);
  } catch (err) {
    fail('liquidate quick completed without error', err);
    return;
  }

  // ── 5. Return shape ───────────────────────────────────────────────────────
  const d = liquidateResult.distribute;

  if (typeof d.signature === 'string' && d.signature.length > 0)
    pass('returns distribute.signature');
  else
    fail('returns distribute.signature', new Error(`got: ${d.signature}`));

  if (typeof d.burnedAmount === 'string' && BigInt(d.burnedAmount) > 0n)
    pass('returns distribute.burnedAmount > 0');
  else
    fail('returns distribute.burnedAmount > 0', new Error(`got: ${d.burnedAmount}`));

  if (d.alreadyDone === false)
    pass('returns distribute.alreadyDone = false on first run');
  else
    fail('returns distribute.alreadyDone = false on first run', new Error(`got: ${d.alreadyDone}`));

  // ── 6. Idempotencysecond liquidate must skip ───────────────────────────
  console.log('\n  Step 5Testing idempotency...');
  try {
    const retry = await liquidate('lp-test-quick-retry')
      .tier('quick')
      .lpMint(poolResult.lpMint)
      .supply(lpSupply)
      .creator(creatorKeypair.publicKey.toBase58())
      .wallet(keypair.secretKey)
      .rpc(RPC)
      .send();

    if (retry.distribute.alreadyDone === true && retry.distribute.signature === null) {
      pass('idempotentsecond run returns alreadyDone=true');
    } else {
      fail('idempotentsecond run returns alreadyDone=true', new Error(
        `got alreadyDone=${retry.distribute.alreadyDone}, sig=${retry.distribute.signature}`
      ));
    }
  } catch (err) {
    fail('idempotentsecond run returns alreadyDone=true', err);
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

console.log('--- @forgekit-labs/lp ---');
testValidation();
await testLiquidateOnDevnet();
console.log('\nDone.');
