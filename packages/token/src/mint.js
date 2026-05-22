import {
  Connection,
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  sendAndConfirmRawTransaction,
} from '@solana/web3.js';
import {
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { ForgeValidationError, ForgeTxError, ForgeRpcError } from '@forgekit-labs/errors';

const VALID_AUTHORITIES = new Set(['freeze', 'mint']);

class MintBuilder {
  #name;
  #supply      = null;
  #decimals    = 6;
  #meta        = null;
  #burnBps     = 0;
  #revocations = new Set();
  #secretKey   = null;
  #rpcUrl      = 'https://api.mainnet-beta.solana.com';

  constructor(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ForgeValidationError(
        'mint() requires a name string.',
        'Pass a unique identifier, e.g. mint("my-token").',
      );
    }
    this.#name = name;
  }

  supply(amount) {
    if (typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
      throw new ForgeValidationError(
        'supply() requires a positive number.',
        'e.g. .supply(1_000_000_000)',
      );
    }
    this.#supply = amount;
    return this;
  }

  decimals(d) {
    if (typeof d !== 'number' || d < 0 || d > 9 || !Number.isInteger(d)) {
      throw new ForgeValidationError(
        'decimals() requires an integer between 0 and 9.',
      );
    }
    this.#decimals = d;
    return this;
  }

  metadata({ name, symbol, uri } = {}) {
    if (!name)   throw new ForgeValidationError('metadata() requires a name field.');
    if (!symbol) throw new ForgeValidationError('metadata() requires a symbol field.');
    if (!uri)    throw new ForgeValidationError('metadata() requires a uri field.');
    this.#meta = { name, symbol, uri };
    return this;
  }

  // Percentage of total supply to burn immediately after mint (0 to 50).
  // Fractional percentages are supported (e.g. burn(2.5) = 250 bps).
  burn(pct) {
    if (typeof pct !== 'number' || pct < 0 || pct > 50) {
      throw new ForgeValidationError(
        'burn() requires a percentage between 0 and 50.',
        'e.g. .burn(2) burns 2% of supply on mint.',
      );
    }
    this.#burnBps = Math.round(pct * 100);
    return this;
  }

  // Call once per authority: .revoke('freeze').revoke('mint')
  revoke(authority) {
    if (!VALID_AUTHORITIES.has(authority)) {
      throw new ForgeValidationError(
        `revoke() received unknown authority "${authority}".`,
        'Valid authorities are "freeze" and "mint".',
      );
    }
    this.#revocations.add(authority);
    return this;
  }

  wallet(secretKey) {
    if (!(secretKey instanceof Uint8Array)) {
      throw new ForgeValidationError(
        'wallet() expects a Uint8Array (your keypair.secretKey).',
        'e.g. .wallet(keypair.secretKey)',
      );
    }
    this.#secretKey = secretKey;
    return this;
  }

  rpc(url) {
    if (typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      throw new ForgeValidationError(
        'rpc() requires a valid HTTP or HTTPS URL.',
        'e.g. .rpc("https://api.mainnet-beta.solana.com")',
      );
    }
    this.#rpcUrl = url;
    return this;
  }

  async send() {
    if (this.#supply === null) {
      throw new ForgeValidationError(
        'No supply defined.',
        'Call .supply(1_000_000_000) before .send().',
      );
    }
    if (!this.#secretKey) {
      throw new ForgeValidationError(
        'No wallet provided.',
        'Call .wallet(keypair.secretKey) before .send().',
      );
    }

    const payer       = Keypair.fromSecretKey(Buffer.from(this.#secretKey));
    const mintKeypair = Keypair.generate();
    const connection  = new Connection(this.#rpcUrl, 'confirmed');

    let blockhash, lamports;
    try {
      [{ blockhash }, lamports] = await Promise.all([
        connection.getLatestBlockhash('confirmed'),
        getMinimumBalanceForRentExemptMint(connection),
      ]);
    } catch (err) {
      throw new ForgeRpcError(
        `Failed to fetch blockhash or rent: ${err?.message ?? String(err)}`,
        err,
      );
    }

    const rawSupply  = BigInt(this.#supply) * BigInt(10 ** this.#decimals);
    const burnAmount = this.#burnBps > 0
      ? (rawSupply * BigInt(this.#burnBps)) / 10_000n
      : 0n;
    const ata = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      payer.publicKey,
    );

    const instructions = [
      // 1. Create mint account
      SystemProgram.createAccount({
        fromPubkey:           payer.publicKey,
        newAccountPubkey:     mintKeypair.publicKey,
        space:                MINT_SIZE,
        lamports,
        programId:            TOKEN_PROGRAM_ID,
      }),
      // 2. Initialise mint
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        this.#decimals,
        payer.publicKey,
        payer.publicKey,
      ),
      // 3. Create payer's associated token account
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        payer.publicKey,
        mintKeypair.publicKey,
      ),
      // 4. Mint full supply to payer ATA
      createMintToInstruction(
        mintKeypair.publicKey,
        ata,
        payer.publicKey,
        rawSupply,
      ),
    ];

    // 5. Burn immediately if configured
    if (burnAmount > 0n) {
      const { createBurnInstruction } = await import('@solana/spl-token');
      instructions.push(
        createBurnInstruction(ata, mintKeypair.publicKey, payer.publicKey, burnAmount),
      );
    }

    // 6. Revoke authorities (order: freeze first, then mint)
    if (this.#revocations.has('freeze')) {
      instructions.push(
        createSetAuthorityInstruction(
          mintKeypair.publicKey,
          payer.publicKey,
          AuthorityType.FreezeAccount,
          null,
        ),
      );
    }
    if (this.#revocations.has('mint')) {
      instructions.push(
        createSetAuthorityInstruction(
          mintKeypair.publicKey,
          payer.publicKey,
          AuthorityType.MintTokens,
          null,
        ),
      );
    }

    const message = new TransactionMessage({
      payerKey:           payer.publicKey,
      recentBlockhash:    blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([payer, mintKeypair]);

    let signature;
    try {
      signature = await sendAndConfirmRawTransaction(
        connection,
        Buffer.from(tx.serialize()),
        { commitment: 'confirmed' },
      );
    } catch (err) {
      throw new ForgeTxError(
        `Transaction failed: ${err?.message ?? String(err)}`,
        err,
      );
    }

    // Return raw amounts as strings. BigInt does not serialise to JSON, and
    // Number loses precision above 2^53 (a 1B supply at 9 decimals overflows).
    return {
      signature,
      mintAddress: mintKeypair.publicKey.toBase58(),
      supply:      rawSupply.toString(),
      burned:      burnAmount.toString(),
      revoked:     [...this.#revocations],
    };
  }
}

export function mint(name) {
  return new MintBuilder(name);
}
