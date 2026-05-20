import { Connection, PublicKey } from '@solana/web3.js';
import { ForgeValidationError, ForgeRpcError, ForgePaymentError } from '@forgekit/errors';

// Mainnet requires 'finalized' for Tower BFT max lockout (rollback-proof).
// Devnet 'confirmed' is sufficient and keeps testing fast.
// Mainnet finalization takes ~13 s, so 8 attempts × 2 s = 16 s ceiling.
// Devnet: 3 attempts × 600 ms.
const MAINNET_COMMITMENT  = 'finalized';
const MAINNET_ATTEMPTS    = 8;
const MAINNET_DELAY_MS    = 2_000;

const DEVNET_COMMITMENT   = 'confirmed';
const DEVNET_ATTEMPTS     = 3;
const DEVNET_DELAY_MS     = 600;

class VerifyBuilder {
  #name;
  #signature = null;
  #sender    = null;
  #recipient = null;
  #amount    = null;
  #rpcUrl    = 'https://api.mainnet-beta.solana.com';

  constructor(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ForgeValidationError(
        'verify() requires a name. Pass a string identifier for this verification.',
        'Example: verify("my-launch-fee")',
      );
    }
    this.#name = name;
  }

  signature(sig) {
    if (typeof sig !== 'string' || !sig.trim()) {
      throw new ForgeValidationError(
        'signature() requires a non-empty string.',
        'Pass the base-58 transaction signature returned after the user broadcasts the payment.',
      );
    }
    this.#signature = sig;
    return this;
  }

  sender(address) {
    if (typeof address !== 'string') {
      throw new ForgeValidationError(
        'sender() requires a string address.',
        'Pass the expected payer\'s base-58 public key. Used to confirm the right wallet paid.',
      );
    }
    try { new PublicKey(address); } catch {
      throw new ForgeValidationError(
        `sender() received an invalid address: "${address}"`,
        'Must be a valid base-58 Solana public key.',
      );
    }
    this.#sender = address;
    return this;
  }

  recipient(address) {
    if (typeof address !== 'string') {
      throw new ForgeValidationError(
        'recipient() requires a string address.',
        'Pass the expected recipient\'s base-58 public key. Typically your platform wallet.',
      );
    }
    try { new PublicKey(address); } catch {
      throw new ForgeValidationError(
        `recipient() received an invalid address: "${address}"`,
        'Must be a valid base-58 Solana public key.',
      );
    }
    this.#recipient = address;
    return this;
  }

  amount(lamports) {
    let parsed;
    try {
      parsed = typeof lamports === 'bigint' ? lamports : BigInt(lamports);
    } catch {
      throw new ForgeValidationError(
        `amount() received a value that cannot be parsed as lamports: ${lamports}`,
        'Pass the exact expected lamport amount as a BigInt, number, or numeric string.',
      );
    }
    if (parsed <= 0n) {
      throw new ForgeValidationError(
        `amount() received ${lamports}. Must be greater than zero.`,
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

  async confirm() {
    if (!this.#signature) {
      throw new ForgeValidationError(
        'verify() is missing the transaction signature. Call .signature("...") before .confirm()',
      );
    }
    if (!this.#sender) {
      throw new ForgeValidationError(
        'verify() is missing the expected sender. Call .sender("...") before .confirm()',
      );
    }
    if (!this.#recipient) {
      throw new ForgeValidationError(
        'verify() is missing the expected recipient. Call .recipient("...") before .confirm()',
      );
    }
    if (this.#amount === null) {
      throw new ForgeValidationError(
        'verify() is missing the expected amount. Call .amount(lamports) before .confirm()',
      );
    }

    const isMainnet   = this.#rpcUrl.toLowerCase().includes('mainnet');
    const commitment  = isMainnet ? MAINNET_COMMITMENT : DEVNET_COMMITMENT;
    const maxAttempts = isMainnet ? MAINNET_ATTEMPTS   : DEVNET_ATTEMPTS;
    const delayMs     = isMainnet ? MAINNET_DELAY_MS   : DEVNET_DELAY_MS;

    const connection = new Connection(this.#rpcUrl, commitment);

    let parsed = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
      try {
        parsed = await connection.getParsedTransaction(this.#signature, {
          commitment,
          maxSupportedTransactionVersion: 0,
        });
      } catch (err) {
        throw new ForgeRpcError(
          `RPC error while fetching transaction ${this.#signature}: ${err?.message ?? String(err)}`,
          err,
        );
      }
      if (parsed) break;
    }

    if (!parsed) {
      throw new ForgePaymentError(
        isMainnet
          ? `Payment transaction not yet finalized. Finalization takes up to 15 seconds on mainnet. Please wait a moment and try again.`
          : `Payment transaction not found. It may not be confirmed yet. Please wait a moment and try again.`,
        'Retry after a short delay. If the problem persists, check the transaction on a Solana explorer.',
      );
    }

    if (parsed.meta.err !== null) {
      throw new ForgePaymentError(
        `Payment transaction failed on-chain: ${JSON.stringify(parsed.meta.err)}`,
        'The transaction was submitted but reverted. The user may need to retry the payment.',
      );
    }

    const instructions = parsed.transaction.message.instructions;
    const transferIx   = instructions.find(
      ix => ix.program === 'system' && ix.parsed?.type === 'transfer'
    );

    if (!transferIx) {
      throw new ForgePaymentError(
        'Payment transaction does not contain a SOL transfer instruction.',
        'Ensure the transaction was built using pay().build() and signed without modification.',
      );
    }

    const { source, destination, lamports } = transferIx.parsed.info;

    if (source !== this.#sender) {
      throw new ForgePaymentError(
        `Payment sender mismatch. Expected ${this.#sender}, got ${source}.`,
        'The transaction was signed by a different wallet than the one that initiated the launch.',
      );
    }

    if (destination !== this.#recipient) {
      throw new ForgePaymentError(
        `Payment recipient mismatch. Expected ${this.#recipient}, got ${destination}.`,
        'The payment was sent to the wrong address.',
      );
    }

    // RPC returns lamports as a JS Number. Cast to BigInt before comparing to
    // avoid silent precision loss on large amounts.
    if (BigInt(lamports) !== this.#amount) {
      throw new ForgePaymentError(
        `Payment amount mismatch. Expected ${this.#amount} lamports, got ${lamports}.`,
        'The exact amount must match. Check that the correct fee + LP seed was passed to pay().',
      );
    }

    return { slot: parsed.slot };
  }
}

export function verify(name) {
  return new VerifyBuilder(name);
}
