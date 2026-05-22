import {
  PublicKey,
  makeConnection,
  makeKeypair,
  basisOf,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from './helpers.js';
import { ForgeValidationError, ForgeTxError, ForgeRpcError } from '@forgekit-labs/errors';
import {
  Raydium,
  TxVersion,
  LOCK_CPMM_PROGRAM,
  LOCK_CPMM_AUTH,
  DEVNET_PROGRAM_ID,
  DEV_API_URLS,
  API_URLS,
} from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';

class LockBuilder {
  #name;
  #poolId    = null;
  #lpMint    = null;
  #lockBps   = 7500;
  #secretKey = null;
  #rpcUrl    = 'https://api.mainnet-beta.solana.com';

  constructor(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ForgeValidationError(
        'lock() requires a name. Pass a string identifier for this operation.',
        'Example: lock("my-pool-safe")',
      );
    }
    this.#name = name;
  }

  poolId(id) {
    if (typeof id !== 'string') {
      throw new ForgeValidationError(
        'poolId() requires a string address.',
        'Pass the poolId returned by launch().send()',
      );
    }
    try { new PublicKey(id); } catch {
      throw new ForgeValidationError(
        `poolId() received an invalid address: "${id}"`,
        'The pool ID must be a valid base-58 Solana public key.',
      );
    }
    this.#poolId = id;
    return this;
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

  basis(bps) {
    if (typeof bps !== 'number' || !Number.isInteger(bps) || bps <= 0 || bps > 10_000) {
      throw new ForgeValidationError(
        `basis() received ${bps}. Must be an integer between 1 and 10000.`,
        'Basis points: 7500 = lock 75% of LP tokens. The remaining 25% stays in the signing wallet.',
      );
    }
    this.#lockBps = bps;
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
    if (!this.#poolId) {
      throw new ForgeValidationError(
        'lock() is missing the pool ID. Call .poolId("...") before .send()',
      );
    }
    if (!this.#lpMint) {
      throw new ForgeValidationError(
        'lock() is missing the LP mint address. Call .lpMint("...") before .send()',
      );
    }
    if (!this.#secretKey) {
      throw new ForgeValidationError(
        'lock() is missing the signing wallet. Call .wallet(keypair.secretKey) before .send()',
      );
    }

    const connection   = makeConnection(this.#rpcUrl);
    const payer        = makeKeypair(this.#secretKey);
    const isDevnet     = this.#rpcUrl.includes('devnet');
    const lpMintPubkey = new PublicKey(this.#lpMint);

    const lockProgram = isDevnet
      ? new PublicKey(DEVNET_PROGRAM_ID.LOCK_CPMM_PROGRAM)
      : LOCK_CPMM_PROGRAM;
    const lockAuth = isDevnet
      ? new PublicKey(DEVNET_PROGRAM_ID.LOCK_CPMM_AUTH)
      : LOCK_CPMM_AUTH;

    const raydium = await Raydium.load({
      connection,
      owner:               payer,
      cluster:             isDevnet ? 'devnet' : 'mainnet',
      disableFeatureCheck: true,
      disableLoadToken:    true,
      blockhashCommitment: 'confirmed',
      urlConfigs:          isDevnet ? DEV_API_URLS : API_URLS,
    });
    await raydium.account.fetchWalletTokenAccounts();

    // ── Fetch pool info from the RPC node directly ───────────────────────────────
    // Bypasses Raydium's API indexer. Critical for newly created pools that may
    // not be indexed yet. A freshly created pool is on-chain immediately but
    // the API can lag by seconds to minutes.
    let poolInfo, poolKeys;
    try {
      ({ poolInfo, poolKeys } = await raydium.cpmm.getPoolInfoFromRpc(this.#poolId));
    } catch (err) {
      throw new ForgeRpcError(
        `Failed to fetch pool info from RPC for pool ${this.#poolId}: ${err?.message ?? String(err)}`,
        err,
      );
    }

    // ── Idempotency: check payer LP ATA balance vs expected platform share ──────
    // Raydium lock transfers tokens to an escrow but does NOT burn them. Total
    // supply is unchanged, which makes it a reliable reference for basis-point
    // calculations both before and after locking.
    const payerLpAta = getAssociatedTokenAddressSync(
      lpMintPubkey,
      payer.publicKey,
      false,
      TOKEN_PROGRAM_ID,
    );

    let totalSupply, currentBalance;
    try {
      const [supplyInfo, ataInfo] = await Promise.all([
        connection.getTokenSupply(lpMintPubkey),
        connection.getTokenAccountBalance(payerLpAta),
      ]);
      totalSupply    = BigInt(supplyInfo.value.amount);
      currentBalance = BigInt(ataInfo.value.amount);
    } catch (err) {
      throw new ForgeRpcError(
        `Failed to fetch LP balance for ${payer.publicKey.toBase58()}: ${err?.message ?? String(err)}`,
        err,
      );
    }

    const platformBps           = 10_000 - this.#lockBps;
    const expectedPlatformShare = basisOf(totalSupply, platformBps);
    const lockAmount            = basisOf(totalSupply, this.#lockBps);

    if (currentBalance <= expectedPlatformShare) {
      return { signature: null, nftMint: null, lockPda: null, alreadyDone: true };
    }

    // ── Build lock transaction ───────────────────────────────────────────────────
    let txData;
    try {
      txData = await raydium.cpmm.lockLp({
        poolInfo,
        poolKeys,
        lpAmount:     new BN(lockAmount.toString()),
        programId:    lockProgram,
        authProgram:  lockAuth,
        withMetadata: true,
        txVersion:    TxVersion.V0,
      });
    } catch (err) {
      throw new ForgeTxError(
        `Failed to build lock transaction: ${err?.message ?? String(err)}`,
        err,
      );
    }

    const { execute, extInfo } = txData;
    let txResult;
    try {
      txResult = await execute({ sendAndConfirm: true });
    } catch (err) {
      throw new ForgeTxError(
        `Lock transaction failed: ${err?.message ?? String(err)}`,
        err,
      );
    }

    return {
      signature:   txResult.txId,
      nftMint:     extInfo?.nftMint?.toBase58() ?? null,
      lockPda:     extInfo?.lockPda?.toBase58()  ?? null,
      alreadyDone: false,
    };
  }
}

export function lock(name) {
  return new LockBuilder(name);
}
