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
  createBurnCheckedInstruction,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
} from './helpers.js';
import { ForgeValidationError, ForgeRpcError } from '@forgekit-labs/errors';

class DistributeBuilder {
  #name;
  #lpMint        = null;
  #supply        = null;
  #platformBps   = null;
  #creatorBps    = 0;
  #creatorWallet = null;
  #secretKey     = null;
  #rpcUrl        = 'https://api.mainnet-beta.solana.com';

  constructor(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ForgeValidationError(
        'distribute() requires a name. Pass a string identifier for this operation.',
        'Example: distribute("my-pool-quick")',
      );
    }
    this.#name = name;
  }

  lpMint(address) {
    if (typeof address !== 'string') {
      throw new ForgeValidationError(
        'lpMint() requires a string address.',
        'Pass the LP mint address returned by launch().send(), e.g. lpMint("7ruhGTX2...").',
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

  supply(amount) {
    let parsed;
    try { parsed = BigInt(amount); } catch {
      throw new ForgeValidationError(
        `supply() received a value that cannot be parsed as an integer: ${amount}`,
        'Pass the original LP mint total supply in raw base units (the string returned by getTokenSupply()).',
      );
    }
    if (parsed <= 0n) {
      throw new ForgeValidationError(
        `supply() received ${amount}. Must be greater than zero.`,
        'Pass the total LP supply before any burn or transfer has occurred.',
      );
    }
    this.#supply = parsed;
    return this;
  }

  platform(bps) {
    if (typeof bps !== 'number' || !Number.isInteger(bps) || bps < 0 || bps > 10_000) {
      throw new ForgeValidationError(
        `platform() received ${bps}. Must be an integer between 0 and 10000.`,
        'Basis points: 2000 = 20%. The platform share is what your signing wallet keeps.',
      );
    }
    this.#platformBps = bps;
    return this;
  }

  creator(bps, wallet) {
    if (typeof bps !== 'number' || !Number.isInteger(bps) || bps < 0 || bps > 10_000) {
      throw new ForgeValidationError(
        `creator() received bps=${bps}. Must be an integer between 0 and 10000.`,
        'Basis points: 1000 = 10%. Pass 0 if there is no creator allocation.',
      );
    }
    if (bps > 0) {
      if (typeof wallet !== 'string') {
        throw new ForgeValidationError(
          'creator() requires a wallet address when bps > 0.',
          'Example: .creator(1000, "3kYxg...")',
        );
      }
      try { new PublicKey(wallet); } catch {
        throw new ForgeValidationError(
          `creator() received an invalid wallet address: "${wallet}"`,
          'The creator wallet must be a valid base-58 Solana public key.',
        );
      }
      this.#creatorWallet = wallet;
    }
    this.#creatorBps = bps;
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
        'distribute() is missing the LP mint address. Call .lpMint("...") before .send()',
      );
    }
    if (this.#supply === null) {
      throw new ForgeValidationError(
        'distribute() is missing the original LP supply. Call .supply("...") before .send()',
        'Pass the total LP supply in raw base units from before any burn or transfer.',
      );
    }
    if (this.#platformBps === null) {
      throw new ForgeValidationError(
        'distribute() is missing the platform share. Call .platform(bps) before .send()',
        'Example: .platform(2000) to keep 20% in the signing wallet.',
      );
    }
    if (!this.#secretKey) {
      throw new ForgeValidationError(
        'distribute() is missing the signing wallet. Call .wallet(keypair.secretKey) before .send()',
      );
    }
    if (this.#platformBps + this.#creatorBps > 10_000) {
      throw new ForgeValidationError(
        `platform (${this.#platformBps}bp) + creator (${this.#creatorBps}bp) exceeds 10000bp. The remainder would be negative.`,
        'Basis points must sum to ≤ 10000. The remainder (10000 - platform - creator) is burned.',
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

    // ── Fetch current balance + decimals ────────────────────────────────────────
    let currentBalance, decimals;
    try {
      const [ataInfo, mintInfo] = await Promise.all([
        connection.getTokenAccountBalance(payerLpAta),
        connection.getParsedAccountInfo(lpMintPubkey),
      ]);
      currentBalance = BigInt(ataInfo.value.amount);
      decimals       = mintInfo.value.data.parsed.info.decimals;
    } catch (err) {
      throw new ForgeRpcError(
        `Failed to fetch LP ATA balance for ${payer.publicKey.toBase58()}: ${err?.message ?? String(err)}`,
        err,
      );
    }

    const expectedPlatformShare = basisOf(this.#supply, this.#platformBps);
    const creatorShare          = basisOf(this.#supply, this.#creatorBps);

    // ── Idempotency ─────────────────────────────────────────────────────────────
    // After the atomic TX the payer ATA = expectedPlatformShare.
    // If it's already at or below that, the distribution is done.
    if (currentBalance <= expectedPlatformShare) {
      return { signature: null, burnedAmount: '0', alreadyDone: true };
    }

    const burnAmount = currentBalance - expectedPlatformShare - creatorShare;
    if (burnAmount < 0n) {
      throw new ForgeValidationError(
        `Burn amount is negative (${burnAmount}). Platform share (${expectedPlatformShare}) + creator share (${creatorShare}) exceeds the current balance (${currentBalance}).`,
        'Verify your basis points configuration and original supply match the on-chain state.',
      );
    }

    // ── Build atomic transaction ─────────────────────────────────────────────────
    const tx = new Transaction();

    if (creatorShare > 0n && this.#creatorWallet) {
      const creatorPubkey = new PublicKey(this.#creatorWallet);
      const creatorLpAta  = getAssociatedTokenAddressSync(
        lpMintPubkey,
        creatorPubkey,
        false,
        TOKEN_PROGRAM_ID,
      );

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
    }

    if (burnAmount > 0n) {
      tx.add(createBurnCheckedInstruction(
        payerLpAta,
        lpMintPubkey,
        payer.publicKey,
        burnAmount,
        decimals,
        [],
        TOKEN_PROGRAM_ID,
      ));
    }

    const signature = await sendTx(connection, tx, [payer]);
    return { signature, burnedAmount: burnAmount.toString(), alreadyDone: false };
  }
}

export function distribute(name) {
  return new DistributeBuilder(name);
}
