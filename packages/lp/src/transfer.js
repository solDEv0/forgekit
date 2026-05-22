import {
  PublicKey,
  Transaction,
  makeConnection,
  makeKeypair,
  sendTx,
  basisOf,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
} from './helpers.js';
import { ForgeValidationError, ForgeRpcError } from '@forgekit-labs/errors';

class TransferBuilder {
  #name;
  #lpMint        = null;
  #platformBps   = null;
  #creatorBps    = null;
  #creatorWallet = null;
  #secretKey     = null;
  #rpcUrl        = 'https://api.mainnet-beta.solana.com';

  constructor(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ForgeValidationError(
        'transfer() requires a name. Pass a string identifier for this operation.',
        'Example: transfer("my-pool-safe")',
      );
    }
    this.#name = name;
  }

  lpMint(address) {
    if (typeof address !== 'string') {
      throw new ForgeValidationError(
        'lpMint() requires a string address.',
        'Pass the LP mint address returned by launch().send()',
      );
    }
    try { new PublicKey(address); } catch {
      throw new ForgeValidationError(
        `lpMint() received an invalid address: "${address}"`,
        'The LP mint address must be a valid base-58 Solana public key.',
      );
    }
    this.#lpMint = address;
    return this;
  }

  platform(bps) {
    if (typeof bps !== 'number' || !Number.isInteger(bps) || bps < 0 || bps > 10_000) {
      throw new ForgeValidationError(
        `platform() received ${bps}. Must be an integer between 0 and 10000.`,
        'Basis points: 1000 = 10%. This is how many LP tokens the signing wallet retains after the transfer.',
      );
    }
    this.#platformBps = bps;
    return this;
  }

  creator(bps, wallet) {
    if (typeof bps !== 'number' || !Number.isInteger(bps) || bps <= 0 || bps > 10_000) {
      throw new ForgeValidationError(
        `creator() received bps=${bps}. Must be a positive integer up to 10000.`,
        'Basis points: 1500 = 15%. This is the share sent to the creator wallet.',
      );
    }
    if (typeof wallet !== 'string') {
      throw new ForgeValidationError(
        'creator() requires a wallet address.',
        'Example: .creator(1500, "3kYxg...")',
      );
    }
    try { new PublicKey(wallet); } catch {
      throw new ForgeValidationError(
        `creator() received an invalid wallet address: "${wallet}"`,
        'The creator wallet must be a valid base-58 Solana public key.',
      );
    }
    this.#creatorBps    = bps;
    this.#creatorWallet = wallet;
    return this;
  }

  wallet(secretKey) {
    if (!(secretKey instanceof Uint8Array)) {
      throw new ForgeValidationError(
        'wallet() requires a Uint8Array secret key.',
        'Pass keypair.secretKey, the Uint8Array from your Keypair. Not a base-58 string.',
      );
    }
    this.#secretKey = secretKey;
    return this;
  }

  rpc(url) {
    if (typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      throw new ForgeValidationError(
        `rpc() received an invalid URL: "${url}"`,
        'Pass a full RPC URL starting with http:// or https://',
      );
    }
    this.#rpcUrl = url;
    return this;
  }

  async send() {
    if (!this.#lpMint) {
      throw new ForgeValidationError(
        'transfer() is missing the LP mint address. Call .lpMint("...") before .send()',
      );
    }
    if (this.#platformBps === null) {
      throw new ForgeValidationError(
        'transfer() is missing the platform share. Call .platform(bps) before .send()',
        'This is the basis points the signing wallet retains. Used for idempotency checking.',
      );
    }
    if (this.#creatorBps === null) {
      throw new ForgeValidationError(
        'transfer() is missing the creator share. Call .creator(bps, wallet) before .send()',
      );
    }
    if (!this.#secretKey) {
      throw new ForgeValidationError(
        'transfer() is missing the signing wallet. Call .wallet(keypair.secretKey) before .send()',
      );
    }

    const connection   = makeConnection(this.#rpcUrl);
    const payer        = makeKeypair(this.#secretKey);
    const lpMintPubkey = new PublicKey(this.#lpMint);

    const payerLpAta = getAssociatedTokenAddressSync(
      lpMintPubkey,
      payer.publicKey,
      false,
      TOKEN_PROGRAM_ID,
    );

    // ── Fetch total supply + current balance + decimals ─────────────────────────
    // LP locking transfers tokens to escrow without burning. Total supply is
    // unchanged and a reliable reference for basis-point calculations.
    let totalSupply, currentBalance, decimals;
    try {
      const [supplyInfo, ataInfo, mintInfo] = await Promise.all([
        connection.getTokenSupply(lpMintPubkey),
        connection.getTokenAccountBalance(payerLpAta),
        connection.getParsedAccountInfo(lpMintPubkey),
      ]);
      totalSupply    = BigInt(supplyInfo.value.amount);
      currentBalance = BigInt(ataInfo.value.amount);
      decimals       = mintInfo.value.data.parsed.info.decimals;
    } catch (err) {
      throw new ForgeRpcError(
        `Failed to fetch LP state for ${this.#lpMint}: ${err?.message ?? String(err)}`,
        err,
      );
    }

    const expectedPlatformShare = basisOf(totalSupply, this.#platformBps);
    const creatorShare          = basisOf(totalSupply, this.#creatorBps);

    // ── Idempotency ─────────────────────────────────────────────────────────────
    // After the transfer the payer ATA = expectedPlatformShare.
    // If it's already at or below that, the transfer is done.
    if (currentBalance <= expectedPlatformShare) {
      return { signature: null, alreadyDone: true };
    }

    const creatorPubkey = new PublicKey(this.#creatorWallet);
    const creatorLpAta  = getAssociatedTokenAddressSync(
      lpMintPubkey,
      creatorPubkey,
      false,
      TOKEN_PROGRAM_ID,
    );

    const tx = new Transaction();

    // Create creator LP ATA if absent. Idempotent, safe to include unconditionally.
    tx.add(createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      creatorLpAta,
      creatorPubkey,
      lpMintPubkey,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ));

    tx.add(createTransferCheckedInstruction(
      payerLpAta,
      lpMintPubkey,
      creatorLpAta,
      payer.publicKey,
      creatorShare,
      decimals,
      [],
      TOKEN_PROGRAM_ID,
    ));

    const signature = await sendTx(connection, tx, [payer]);
    return { signature, alreadyDone: false };
  }
}

export function transfer(name) {
  return new TransferBuilder(name);
}
