import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createBurnCheckedInstruction,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import { ForgeRpcError, ForgeTxError } from '@forgekit-labs/errors';

export function makeConnection(rpcUrl) {
  return new Connection(rpcUrl, 'confirmed');
}

export function makeKeypair(secretKey) {
  return Keypair.fromSecretKey(Buffer.from(secretKey));
}

export async function fetchLpMintInfo(connection, lpMintPubkey) {
  try {
    const [supplyInfo, mintInfo] = await Promise.all([
      connection.getTokenSupply(lpMintPubkey),
      connection.getParsedAccountInfo(lpMintPubkey),
    ]);
    return {
      totalSupply: BigInt(supplyInfo.value.amount),
      decimals:    mintInfo.value.data.parsed.info.decimals,
    };
  } catch (err) {
    throw new ForgeRpcError(
      `Failed to fetch LP mint info: ${err?.message ?? String(err)}`,
      err,
    );
  }
}

export async function fetchAtaBalance(connection, lpMintPubkey, ownerPubkey) {
  const ata = getAssociatedTokenAddressSync(lpMintPubkey, ownerPubkey, false, TOKEN_PROGRAM_ID);
  try {
    const info = await connection.getTokenAccountBalance(ata);
    return { ata, balance: BigInt(info.value.amount) };
  } catch (err) {
    throw new ForgeRpcError(
      `Failed to fetch LP ATA balance for ${ownerPubkey.toBase58()}: ${err?.message ?? String(err)}`,
      err,
    );
  }
}

export async function sendTx(connection, transaction, signers) {
  try {
    const { sendAndConfirmTransaction } = await import('@solana/web3.js');
    return await sendAndConfirmTransaction(connection, transaction, signers, { commitment: 'confirmed' });
  } catch (err) {
    throw new ForgeTxError(
      `Transaction failed: ${err?.message ?? String(err)}`,
      err,
    );
  }
}

export function basisOf(total, bps) {
  return (total * BigInt(bps)) / 10_000n;
}

export { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync };
export { PublicKey, Transaction };
export {
  createBurnCheckedInstruction,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
};
