import { ForgeValidationError } from '@forgekit/errors';
import { distribute } from './distribute.js';
import { lock }       from './lock.js';
import { transfer }   from './transfer.js';
import { PublicKey }  from './helpers.js';

// Quick tier default splits (basis points)
const QUICK_PLATFORM_BPS = 2000;  // 20%
const QUICK_CREATOR_BPS  = 1000;  // 10%
// 70% burned

// Safe tier default splits (basis points)
const SAFE_LOCK_BPS      = 7500;  // 75% locked
const SAFE_PLATFORM_BPS  = 1000;  // 10% platform keeps
const SAFE_CREATOR_BPS   = 1500;  // 15% to creator

class LiquidateBuilder {
  #name;
  #tier          = null;
  #lpMint        = null;
  #poolId        = null;
  #supply        = null;
  #creatorWallet = null;
  #secretKey     = null;
  #rpcUrl        = 'https://api.mainnet-beta.solana.com';

  constructor(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ForgeValidationError(
        'liquidate() requires a name. Pass a string identifier for this operation.',
        'Example: liquidate("my-pool")',
      );
    }
    this.#name = name;
  }

  tier(value) {
    if (value !== 'quick' && value !== 'safe') {
      throw new ForgeValidationError(
        `tier() received "${value}". Must be "quick" or "safe".`,
        '"quick" burns 70%, transfers 10% to creator, keeps 20% as platform. ' +
        '"safe" locks 75%, transfers 15% to creator, keeps 10% as platform.',
      );
    }
    this.#tier = value;
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

  poolId(id) {
    if (typeof id !== 'string') {
      throw new ForgeValidationError(
        'poolId() requires a string address.',
        'Pass the poolId returned by launch().send(). Required for the "safe" tier lock step.',
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

  supply(amount) {
    let parsed;
    try { parsed = BigInt(amount); } catch {
      throw new ForgeValidationError(
        `supply() received a value that cannot be parsed as an integer: ${amount}`,
        'Pass the original LP mint total supply in raw base units. Required for the "quick" tier distribute step.',
      );
    }
    if (parsed <= 0n) {
      throw new ForgeValidationError(
        `supply() received ${amount}. Must be greater than zero.`,
      );
    }
    this.#supply = parsed;
    return this;
  }

  creator(wallet) {
    if (typeof wallet !== 'string') {
      throw new ForgeValidationError(
        'creator() requires a wallet address string.',
        'Pass the creator\'s Solana wallet address. LP tokens will be sent here.',
      );
    }
    try { new PublicKey(wallet); } catch {
      throw new ForgeValidationError(
        `creator() received an invalid wallet address: "${wallet}"`,
        'The creator wallet must be a valid base-58 Solana public key.',
      );
    }
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
    if (!this.#tier) {
      throw new ForgeValidationError(
        'liquidate() is missing the tier. Call .tier("quick") or .tier("safe") before .send()',
      );
    }
    if (!this.#lpMint) {
      throw new ForgeValidationError(
        'liquidate() is missing the LP mint address. Call .lpMint("...") before .send()',
      );
    }
    if (!this.#creatorWallet) {
      throw new ForgeValidationError(
        'liquidate() is missing the creator wallet. Call .creator("...") before .send()',
      );
    }
    if (!this.#secretKey) {
      throw new ForgeValidationError(
        'liquidate() is missing the signing wallet. Call .wallet(keypair.secretKey) before .send()',
      );
    }
    if (this.#tier === 'quick' && this.#supply === null) {
      throw new ForgeValidationError(
        'liquidate("quick") requires the original LP supply. Call .supply("...") before .send()',
        'The quick tier burns the majority of LP tokens. The supply is needed to calculate exact amounts.',
      );
    }
    if (this.#tier === 'safe' && !this.#poolId) {
      throw new ForgeValidationError(
        'liquidate("safe") requires the pool ID. Call .poolId("...") before .send()',
        'The safe tier locks LP tokens via Raydium\'s lock program, which requires the pool ID.',
      );
    }

    if (this.#tier === 'quick') {
      return this.#runQuick();
    }
    return this.#runSafe();
  }

  async #runQuick() {
    const result = await distribute(`${this.#name}:distribute`)
      .lpMint(this.#lpMint)
      .supply(this.#supply.toString())
      .platform(QUICK_PLATFORM_BPS)
      .creator(QUICK_CREATOR_BPS, this.#creatorWallet)
      .wallet(this.#secretKey)
      .rpc(this.#rpcUrl)
      .send();

    return { distribute: result };
  }

  async #runSafe() {
    const lockResult = await lock(`${this.#name}:lock`)
      .poolId(this.#poolId)
      .lpMint(this.#lpMint)
      .basis(SAFE_LOCK_BPS)
      .wallet(this.#secretKey)
      .rpc(this.#rpcUrl)
      .send();

    const transferResult = await transfer(`${this.#name}:transfer`)
      .lpMint(this.#lpMint)
      .platform(SAFE_PLATFORM_BPS)
      .creator(SAFE_CREATOR_BPS, this.#creatorWallet)
      .wallet(this.#secretKey)
      .rpc(this.#rpcUrl)
      .send();

    return { lock: lockResult, transfer: transferResult };
  }
}

export function liquidate(name) {
  return new LiquidateBuilder(name);
}
