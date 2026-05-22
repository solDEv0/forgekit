import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { ForgeValidationError, ForgeRpcError } from '@forgekit-labs/errors';

class PayBuilder {
  #name;
  #from   = null;
  #to     = null;
  #amount = null;
  #rpcUrl = 'https://api.mainnet-beta.solana.com';

  constructor(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ForgeValidationError(
        'pay() requires a name. Pass a string identifier for this payment.',
        'Example: pay("my-launch-fee")',
      );
    }
    this.#name = name;
  }

  from(address) {
    if (typeof address !== 'string') {
      throw new ForgeValidationError(
        'from() requires a string address.',
        'Pass the payer\'s base-58 public key. The wallet that will sign and send the transaction.',
      );
    }
    try { new PublicKey(address); } catch {
      throw new ForgeValidationError(
        `from() received an invalid address: "${address}"`,
        'Must be a valid base-58 Solana public key.',
      );
    }
    this.#from = address;
    return this;
  }

  to(address) {
    if (typeof address !== 'string') {
      throw new ForgeValidationError(
        'to() requires a string address.',
        'Pass the recipient\'s base-58 public key. Typically your platform wallet.',
      );
    }
    try { new PublicKey(address); } catch {
      throw new ForgeValidationError(
        `to() received an invalid address: "${address}"`,
        'Must be a valid base-58 Solana public key.',
      );
    }
    this.#to = address;
    return this;
  }

  amount(lamports) {
    let parsed;
    try {
      parsed = typeof lamports === 'bigint' ? lamports : BigInt(lamports);
    } catch {
      throw new ForgeValidationError(
        `amount() received a value that cannot be parsed as lamports: ${lamports}`,
        'Pass the amount in lamports as a BigInt, number, or numeric string. 1 SOL = 1_000_000_000 lamports.',
      );
    }
    if (parsed <= 0n) {
      throw new ForgeValidationError(
        `amount() received ${lamports}. Must be greater than zero.`,
        'Pass the total lamports to transfer, including any platform fee.',
      );
    }
    this.#amount = parsed;
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

  async build() {
    if (!this.#from) {
      throw new ForgeValidationError(
        'pay() is missing the sender. Call .from("...") before .build()',
        'Pass the payer\'s public key. This wallet will sign and broadcast the transaction.',
      );
    }
    if (!this.#to) {
      throw new ForgeValidationError(
        'pay() is missing the recipient. Call .to("...") before .build()',
      );
    }
    if (this.#amount === null) {
      throw new ForgeValidationError(
        'pay() is missing the amount. Call .amount(lamports) before .build()',
      );
    }

    const connection = new Connection(this.#rpcUrl, 'confirmed');
    const fromPubkey = new PublicKey(this.#from);
    const toPubkey   = new PublicKey(this.#to);

    // 'confirmed' blockhash: 'finalized' shrinks the validity window unnecessarily;
    // 'processed' risks building on a fork. 'confirmed' is the right balance.
    let blockhash, lastValidBlockHeight;
    try {
      ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed'));
    } catch (err) {
      throw new ForgeRpcError(
        `Failed to fetch recent blockhash: ${err?.message ?? String(err)}`,
        err,
      );
    }

    const messageV0 = new TransactionMessage({
      payerKey:        fromPubkey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey,
          toPubkey,
          lamports: this.#amount,
        }),
      ],
    }).compileToV0Message();

    // Serialise unsigned. Empty signatures slot is valid; the frontend
    // deserialises, signs with the user's wallet, and broadcasts.
    const tx         = new VersionedTransaction(messageV0);
    const serialized = Buffer.from(tx.serialize()).toString('base64');

    return {
      transaction:          serialized,
      blockhash,
      lastValidBlockHeight,
      totalLamports:        this.#amount.toString(),
    };
  }
}

export function pay(name) {
  return new PayBuilder(name);
}
