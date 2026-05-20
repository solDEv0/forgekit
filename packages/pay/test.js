import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { pay, verify, ForgeValidationError, ForgePaymentError } from './src/index.js';

const RPC = 'https://api.devnet.solana.com';

// Load devnet secret from env var. Integration tests skip if unset.
const TEST_SECRET = process.env.FORGEKIT_DEVNET_SECRET;

function pass(label) { console.log(`  PASS  ${label}`); }
function fail(label, err) { console.error(`  FAIL  ${label}\n        ${err?.message ?? err}`); process.exitCode = 1; }

// ── Validation tests (no network) ────────────────────────────────────────────

function testValidation() {
  console.log('\nValidationpay()');

  const addr = 'abc123abc123abc123abc123abc123ab';

  const payCases = [
    ['rejects missing name',        () => pay(),                                                    ForgeValidationError],
    ['rejects non-string name',     () => pay(42),                                                  ForgeValidationError],
    ['rejects bad from address',    () => pay('x').from('notakey'),                                 ForgeValidationError],
    ['rejects bad to address',      () => pay('x').from(addr).to('notakey'),                        ForgeValidationError],
    ['rejects zero amount',         () => pay('x').from(addr).to(addr).amount(0),                   ForgeValidationError],
    ['rejects negative amount',     () => pay('x').from(addr).to(addr).amount(-1),                  ForgeValidationError],
    ['rejects non-numeric amount',  () => pay('x').from(addr).to(addr).amount('abc'),               ForgeValidationError],
    ['rejects bad rpc url',         () => pay('x').from(addr).to(addr).amount(1000n).rpc('nope'),   ForgeValidationError],
    ['rejects build with no from',  () => pay('x').to(addr).amount(1000n).build(),                  ForgeValidationError],
    ['rejects build with no to',    () => pay('x').from(addr).amount(1000n).build(),                ForgeValidationError],
    ['rejects build with no amount',() => pay('x').from(addr).to(addr).build(),                     ForgeValidationError],
  ];

  runCases(payCases);

  console.log('\nValidationverify()');

  const verifyCases = [
    ['rejects missing name',            () => verify(),                                                                              ForgeValidationError],
    ['rejects bad signature',           () => verify('x').signature(''),                                                             ForgeValidationError],
    ['rejects bad sender address',      () => verify('x').signature('sig').sender('notakey'),                                        ForgeValidationError],
    ['rejects bad recipient address',   () => verify('x').signature('sig').sender(addr).recipient('notakey'),                        ForgeValidationError],
    ['rejects zero amount',             () => verify('x').signature('sig').sender(addr).recipient(addr).amount(0),                   ForgeValidationError],
    ['rejects bad rpc url',             () => verify('x').signature('sig').sender(addr).recipient(addr).amount(1000n).rpc('nope'),   ForgeValidationError],
    ['rejects confirm with no sig',     () => verify('x').sender(addr).recipient(addr).amount(1000n).confirm(),                      ForgeValidationError],
    ['rejects confirm with no sender',  () => verify('x').signature('sig').recipient(addr).amount(1000n).confirm(),                  ForgeValidationError],
    ['rejects confirm with no recip',   () => verify('x').signature('sig').sender(addr).amount(1000n).confirm(),                     ForgeValidationError],
    ['rejects confirm with no amount',  () => verify('x').signature('sig').sender(addr).recipient(addr).confirm(),                   ForgeValidationError],
  ];

  runCases(verifyCases);
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

async function testPayOnDevnet() {
  console.log('\nIntegration (devnet)');

  if (!TEST_SECRET) {
    console.log('  SKIP  Set FORGEKIT_DEVNET_SECRET to run on-chain tests.');
    return;
  }

  const keypair    = Keypair.fromSecretKey(bs58.decode(TEST_SECRET));
  const connection = new Connection(RPC, 'confirmed');
  const recipient  = Keypair.generate();  // throwawayjust needs to be a valid address

  console.log(`  Wallet  ${keypair.publicKey.toBase58()}`);

  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`  Balance ${(balance / 1e9).toFixed(4)} SOL`);

  if (balance < 0.01 * 1e9) {
    fail('sufficient devnet SOL (need ~0.01)', new Error(`only ${(balance / 1e9).toFixed(4)} SOL available`));
    return;
  }

  const AMOUNT = 1_000_000n; // 0.001 SOLsmall enough to not waste devnet funds

  // ── 1. Build the unsigned payment tx ──────────────────────────────────────
  console.log('\n  Step 1Building unsigned payment tx...');
  let built;
  try {
    built = await pay('devnet-test')
      .from(keypair.publicKey.toBase58())
      .to(recipient.publicKey.toBase58())
      .amount(AMOUNT)
      .rpc(RPC)
      .build();

    pass('pay().build() returned without error');
  } catch (err) {
    fail('pay().build() returned without error', err);
    return;
  }

  // ── 2. Return shape ───────────────────────────────────────────────────────
  if (typeof built.transaction === 'string' && built.transaction.length > 0)
    pass('returns transaction (base64 string)');
  else
    fail('returns transaction (base64 string)', new Error(`got: ${built.transaction}`));

  if (typeof built.blockhash === 'string')
    pass('returns blockhash');
  else
    fail('returns blockhash', new Error(`got: ${built.blockhash}`));

  if (typeof built.lastValidBlockHeight === 'number')
    pass('returns lastValidBlockHeight');
  else
    fail('returns lastValidBlockHeight', new Error(`got: ${built.lastValidBlockHeight}`));

  if (built.totalLamports === AMOUNT.toString())
    pass('returns correct totalLamports');
  else
    fail('returns correct totalLamports', new Error(`got: ${built.totalLamports}`));

  // ── 3. Sign and broadcast (simulating the frontend) ───────────────────────
  console.log('\n  Step 2Signing and broadcasting...');
  let signature;
  try {
    const txBytes = Buffer.from(built.transaction, 'base64');
    const tx      = VersionedTransaction.deserialize(txBytes);
    tx.sign([keypair]);

    signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight:       false,
      preflightCommitment: 'confirmed',
    });
    await connection.confirmTransaction({
      signature,
      blockhash:            built.blockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
    }, 'confirmed');

    pass('transaction signed, broadcast, and confirmed');
    console.log(`  Sig     ${signature}`);
  } catch (err) {
    fail('transaction signed, broadcast, and confirmed', err);
    return;
  }

  // ── 4. Verify the confirmed payment ───────────────────────────────────────
  console.log('\n  Step 3Verifying on-chain payment...');
  let verifyResult;
  try {
    verifyResult = await verify('devnet-test')
      .signature(signature)
      .sender(keypair.publicKey.toBase58())
      .recipient(recipient.publicKey.toBase58())
      .amount(AMOUNT)
      .rpc(RPC)
      .confirm();

    pass('verify().confirm() returned without error');
  } catch (err) {
    fail('verify().confirm() returned without error', err);
    return;
  }

  if (typeof verifyResult.slot === 'number' && verifyResult.slot > 0)
    pass('returns slot number');
  else
    fail('returns slot number', new Error(`got: ${verifyResult.slot}`));

  // ── 5. Verify rejects wrong sender ────────────────────────────────────────
  console.log('\n  Step 4Verify rejects tampered parameters...');
  const fakeWallet = Keypair.generate().publicKey.toBase58();

  try {
    await verify('devnet-test-bad-sender')
      .signature(signature)
      .sender(fakeWallet)
      .recipient(recipient.publicKey.toBase58())
      .amount(AMOUNT)
      .rpc(RPC)
      .confirm();

    fail('rejects wrong sender', new Error('Expected ForgePaymentError but none thrown'));
  } catch (err) {
    if (err instanceof ForgePaymentError) pass('rejects wrong sender');
    else fail('rejects wrong sender', err);
  }

  // ── 6. Verify rejects wrong amount ────────────────────────────────────────
  try {
    await verify('devnet-test-bad-amount')
      .signature(signature)
      .sender(keypair.publicKey.toBase58())
      .recipient(recipient.publicKey.toBase58())
      .amount(AMOUNT + 1n)
      .rpc(RPC)
      .confirm();

    fail('rejects wrong amount', new Error('Expected ForgePaymentError but none thrown'));
  } catch (err) {
    if (err instanceof ForgePaymentError) pass('rejects wrong amount');
    else fail('rejects wrong amount', err);
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

console.log('--- @forgekit/pay ---');
testValidation();
await testPayOnDevnet();
await new Promise(r => setTimeout(r, 200));
console.log('\nDone.');
