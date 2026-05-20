import fs             from 'fs';
import path           from 'path';
import { Readable }   from 'stream';
import { TurboFactory } from '@ardrive/turbo-sdk';
import bs58            from 'bs58';
import {
  ForgeValidationError,
  ForgeUploadError,
  ForgeBalanceError,
  ForgeTimeoutError,
} from '@forgekit/errors';

const ARWEAVE_GATEWAY = 'https://arweave.net';
const FREE_TIER_BYTES = 100 * 1024;

class CastBuilder {
  #name;
  #imageSrc  = null;
  #metadata  = {};
  #attrs     = [];
  #secretKey = null;

  constructor(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ForgeValidationError(
        'cast() requires a name string.',
        'Pass a unique identifier for this upload, e.g. cast("my-token").',
      );
    }
    this.#name = name;
  }

  image(src) {
    this.#imageSrc = src;
    return this;
  }

  describe({ name, symbol, description, ...rest } = {}) {
    if (!name)        throw new ForgeValidationError('describe() requires a name field.');
    if (!symbol)      throw new ForgeValidationError('describe() requires a symbol field.');
    if (!description) throw new ForgeValidationError('describe() requires a description field.');
    this.#metadata = { name, symbol, description, ...rest };
    return this;
  }

  attributes(attrs = []) {
    if (!Array.isArray(attrs)) {
      throw new ForgeValidationError(
        'attributes() expects an array.',
        'Pass an array of { trait_type, value } objects.',
      );
    }
    this.#attrs = attrs;
    return this;
  }

  // Accepts a Solana secretKey as Uint8Array (e.g. keypair.secretKey).
  // Buffer is also accepted since it extends Uint8Array.
  wallet(secretKey) {
    if (!(secretKey instanceof Uint8Array)) {
      throw new ForgeValidationError(
        'wallet() expects a Uint8Array (your Solana keypair.secretKey).',
        'Pass your wallet secretKey directly: .wallet(keypair.secretKey)',
      );
    }
    this.#secretKey = secretKey;
    return this;
  }

  async deploy() {
    if (!this.#imageSrc) {
      throw new ForgeValidationError(
        'No image provided.',
        'Call .image("./path/to/image.png") or .image(buffer) before .deploy().',
      );
    }
    if (!this.#metadata.name) {
      throw new ForgeValidationError(
        'No metadata provided.',
        'Call .describe({ name, symbol, description }) before .deploy().',
      );
    }
    if (!this.#secretKey) {
      throw new ForgeValidationError(
        'No wallet provided.',
        'Call .wallet(keypair.secretKey) before .deploy(). Turbo requires a Solana wallet to sign uploads.',
      );
    }

    const turbo = TurboFactory.authenticated({
      privateKey: bs58.encode(this.#secretKey),
      token:      'solana',
    });

    const { uri: imageUri, contentType } = await this.#uploadImage(turbo);
    const metaUri = await this.#uploadMetadata(turbo, imageUri, contentType);

    return { uri: metaUri, image: imageUri };
  }

  async #uploadImage(turbo) {
    let buffer, contentType;

    if (Buffer.isBuffer(this.#imageSrc) || this.#imageSrc instanceof Uint8Array) {
      buffer      = Buffer.from(this.#imageSrc);
      contentType = 'image/png';
    } else {
      const resolved = path.resolve(this.#imageSrc);
      if (!fs.existsSync(resolved)) {
        throw new ForgeValidationError(
          `Image not found at path: ${resolved}`,
          'Provide an absolute path, a path relative to your working directory, or a Buffer.',
        );
      }
      buffer      = fs.readFileSync(resolved);
      contentType = resolveContentType(resolved);
    }

    if (buffer.byteLength > FREE_TIER_BYTES) {
      throw new ForgeBalanceError(
        null,
        `Image is ${(buffer.byteLength / 1024).toFixed(1)} KB. Over the 100 KB free tier limit. Top up Turbo credits to upload larger files.`,
      );
    }

    const uri = await this.#upload(turbo, buffer, contentType);
    return { uri, contentType };
  }

  async #uploadMetadata(turbo, imageUri, imageContentType) {
    const json = JSON.stringify({
      name:        this.#metadata.name,
      symbol:      this.#metadata.symbol,
      description: this.#metadata.description,
      image:       imageUri,
      attributes:  this.#attrs,
      properties: {
        files:    [{ uri: imageUri, type: imageContentType }],
        category: 'image',
      },
      ...omit(this.#metadata, ['name', 'symbol', 'description']),
    }, null, 2);

    const buffer = Buffer.from(json, 'utf8');
    return this.#upload(turbo, buffer, 'application/json');
  }

  async #upload(turbo, buffer, contentType) {
    try {
      const { id } = await turbo.uploadFile({
        fileStreamFactory: () => Readable.from(buffer),
        fileSizeFactory:   () => buffer.byteLength,
        dataItemOpts:      { tags: [{ name: 'Content-Type', value: contentType }] },
      });
      return `${ARWEAVE_GATEWAY}/${id}`;
    } catch (err) {
      if (err?.message?.toLowerCase().includes('timeout')) {
        throw new ForgeTimeoutError(err);
      }
      if (err?.message?.toLowerCase().includes('balance') || err?.status === 402) {
        throw new ForgeBalanceError(err);
      }
      throw new ForgeUploadError(
        `Upload failed: ${err?.message ?? String(err)}`,
        err,
      );
    }
  }
}

function resolveContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.svg':  'image/svg+xml',
  };
  return map[ext] ?? 'application/octet-stream';
}

function omit(obj, keys) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}

export function cast(name) {
  return new CastBuilder(name);
}
