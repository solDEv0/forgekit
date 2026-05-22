import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  Raydium,
  TxVersion,
  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_FEE_ACC,
  DEVNET_PROGRAM_ID,
  DEV_API_URLS,
  API_URLS,
} from '@raydium-io/raydium-sdk-v2';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import {
  CPMM_FEE_CONFIGS,
  VALID_FEE_TIERS,
  MIN_SEED_SOL,
  WSOL_MINT,
} from './fees.js';
import {
  ForgeValidationError,
  ForgeTxError,
  ForgeRpcError,
  ForgePoolExistsError,
} from '@forgekit-labs/errors';

const LAMPORTS_PER_SOL = 1_000_000_000n;

class LaunchBuilder {
  #name;
  #mintAddress  = null;
  #mintDecimals = null;
  #tokenAmount  = null;
  #seedSol      = null;
  #feeTier      = 1;
  #secretKey    = null;
  #rpcUrl       = 'https://api.mainnet-beta.solana.com';

  constructor(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ForgeValidationError(
        'launch() requires a name string.',
        'Pass a unique identifier, e.g. launch("my-pool").',
      );
    }
    this.#name = name;
  }

  // Token mint address to pair with SOL
  mint(address) {
    if (typeof address !== 'string') {
      throw new ForgeValidationError(
        'mint() requires a string address.',
        'Pass the token mint address as a base-58 Solana public key.',
      );
    }
    try { new PublicKey(address); } catch {
      throw new ForgeValidationError(
        `mint() received an invalid address: "${address}"`,
        'The mint address must be a valid base-58 Solana public key.',
      );
    }
    this.#mintAddress = address;
    return this;
  }

  // Token decimals, required to calculate raw amounts correctly
  decimals(d) {
    if (typeof d !== 'number' || d < 0 || d > 9 || !Number.isInteger(d)) {
      throw new ForgeValidationError(
        'decimals() requires an integer between 0 and 9.',
      );
    }
    this.#mintDecimals = d;
    return this;
  }

  // Number of tokens (in human units) to seed into the pool
  tokens(amount) {
    if (typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
      throw new ForgeValidationError(
        'tokens() requires a positive number.',
        'e.g. .tokens(500_000_000) to seed 500M tokens into the pool.',
      );
    }
    this.#tokenAmount = amount;
    return this;
  }

  // SOL to seed the pool. Minimum 0.65 (0.15 creation fee + 0.50 liquidity).
  seed(sol) {
    if (typeof sol !== 'number' || !Number.isFinite(sol)) {
      throw new ForgeValidationError('seed() requires a number.');
    }
    if (sol < MIN_SEED_SOL) {
      throw new ForgeValidationError(
        `seed() received ${sol} SOL. Below the minimum of ${MIN_SEED_SOL} SOL.`,
        `Raydium CPMM requires at least ${MIN_SEED_SOL} SOL: 0.15 SOL is consumed as ` +
        `the pool creation fee, leaving 0.50 SOL as the minimum pool liquidity. ` +
        `Anything below this will be rejected on-chain.`,
      );
    }
    this.#seedSol = sol;
    return this;
  }

  // Swap fee tier: 1 (1%) or 2 (2%). Devnet only supports 1%.
  feeTier(pct) {
    if (!VALID_FEE_TIERS.has(pct)) {
      throw new ForgeValidationError(
        `feeTier() received ${pct}. Only 1 and 2 are valid Raydium CPMM fee tiers.`,
        'Use .feeTier(1) for 1% swap fee or .feeTier(2) for 2% swap fee.',
      );
    }
    this.#feeTier = pct;
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
      );
    }
    this.#rpcUrl = url;
    return this;
  }

  async send() {
    if (!this.#mintAddress) {
      throw new ForgeValidationError(
        'No mint address provided.',
        'Call .mint("your-token-mint-address") before .send().',
      );
    }
    if (this.#mintDecimals === null) {
      throw new ForgeValidationError(
        'No decimals provided.',
        'Call .decimals(6) before .send().',
      );
    }
    if (this.#tokenAmount === null) {
      throw new ForgeValidationError(
        'No token amount provided.',
        'Call .tokens(500_000_000) before .send().',
      );
    }
    if (this.#seedSol === null) {
      throw new ForgeValidationError(
        'No SOL seed amount provided.',
        `Call .seed(${MIN_SEED_SOL}) before .send().`,
      );
    }
    if (!this.#secretKey) {
      throw new ForgeValidationError(
        'No wallet provided.',
        'Call .wallet(keypair.secretKey) before .send().',
      );
    }

    const isDevnet  = this.#rpcUrl.toLowerCase().includes('devnet');
    const network   = isDevnet ? 'devnet' : 'mainnet';
    const feeConfig = CPMM_FEE_CONFIGS[network][this.#feeTier];

    const owner      = Keypair.fromSecretKey(Buffer.from(this.#secretKey));
    const connection = new Connection(this.#rpcUrl, 'confirmed');

    // Load Raydium SDK
    let raydium;
    try {
      raydium = await Raydium.load({
        connection,
        owner,
        cluster:             isDevnet ? 'devnet' : 'mainnet',
        disableFeatureCheck: true,
        disableLoadToken:    true,
        blockhashCommitment: 'confirmed',
        urlConfigs:          isDevnet ? DEV_API_URLS : API_URLS,
      });
      await raydium.account.fetchWalletTokenAccounts();
    } catch (err) {
      throw new ForgeRpcError(
        `Failed to initialise Raydium SDK: ${err?.message ?? String(err)}`,
        err,
      );
    }

    const programIds = isDevnet
      ? {
          programId:      new PublicKey(DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM),
          poolFeeAccount: new PublicKey(DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC),
        }
      : {
          programId:      CREATE_CPMM_POOL_PROGRAM,
          poolFeeAccount: CREATE_CPMM_POOL_FEE_ACC,
        };

    const rawTokenAmount = BigInt(Math.round(this.#tokenAmount * (10 ** this.#mintDecimals)));
    const rawSolLamports = BigInt(Math.round(this.#seedSol * Number(LAMPORTS_PER_SOL)));

    const mintA = {
      address:   this.#mintAddress,
      decimals:  this.#mintDecimals,
      programId: TOKEN_PROGRAM_ID.toBase58(),
    };
    const mintB = {
      address:   WSOL_MINT,
      decimals:  9,
      programId: TOKEN_PROGRAM_ID.toBase58(),
    };

    // Build the pool creation transaction
    let txData;
    try {
      txData = await raydium.cpmm.createPool({
        programId:           programIds.programId,
        poolFeeAccount:      programIds.poolFeeAccount,
        mintA,
        mintB,
        mintAAmount:         new BN(rawTokenAmount.toString()),
        mintBAmount:         new BN(rawSolLamports.toString()),
        startTime:           new BN(0),
        feeConfig,
        associatedOnly:      false,
        checkCreateATAOwner: false,
        ownerInfo: { useSOLBalance: true },
        txVersion:           TxVersion.V0,
      });
    } catch (err) {
      throw new ForgeTxError(
        `Failed to build pool transaction: ${err?.message ?? String(err)}`,
        err,
      );
    }

    const { execute, extInfo } = txData;
    const poolId = extInfo.address.poolId.toBase58();
    const lpMint = extInfo.address.lpMint.toBase58();

    // Idempotency. Pool PDA is deterministic; if it exists we surface it clearly.
    let existingPool;
    try {
      existingPool = await connection.getAccountInfo(extInfo.address.poolId);
    } catch (err) {
      throw new ForgeRpcError(
        `Failed to check for existing pool: ${err?.message ?? String(err)}`,
        err,
      );
    }

    if (existingPool !== null) {
      throw new ForgePoolExistsError(poolId);
    }

    // Submit
    let txId;
    try {
      const result = await execute({ sendAndConfirm: true });
      txId = result.txId;
    } catch (err) {
      throw new ForgeTxError(
        `Pool creation transaction failed: ${err?.message ?? String(err)}`,
        err,
      );
    }

    return { poolId, lpMint, signature: txId };
  }
}

export function launch(name) {
  return new LaunchBuilder(name);
}
