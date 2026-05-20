export class ForgeError extends Error {
  constructor({ code, message, cause = null, retry = false, hint = null }) {
    super(message);
    this.name  = 'ForgeError';
    this.code  = code;
    this.cause = cause;
    this.retry = retry;
    this.hint  = hint;
  }
}

export class ForgeValidationError extends ForgeError {
  constructor(message, hint = null) {
    super({ code: 'VALIDATION_ERROR', message, retry: false, hint });
    this.name = 'ForgeValidationError';
  }
}

export class ForgeTxError extends ForgeError {
  constructor(message, cause = null, hint = null) {
    super({
      code:  'TX_FAILED',
      message,
      cause,
      retry: true,
      hint:  hint ?? 'Check your RPC endpoint, wallet balance, and try again.',
    });
    this.name = 'ForgeTxError';
  }
}

export class ForgeRpcError extends ForgeError {
  constructor(message, cause = null, hint = null) {
    super({
      code:  'RPC_ERROR',
      message,
      cause,
      retry: true,
      hint:  hint ?? 'The RPC node may be congested or unreachable. Try a different endpoint.',
    });
    this.name = 'ForgeRpcError';
  }
}

export class ForgeUploadError extends ForgeError {
  constructor(message, cause = null, hint = null) {
    super({
      code:  'UPLOAD_FAILED',
      message,
      cause,
      retry: true,
      hint:  hint ?? 'Check your network connection and try again.',
    });
    this.name = 'ForgeUploadError';
  }
}

export class ForgeBalanceError extends ForgeError {
  constructor(cause = null, hint = null) {
    super({
      code:    'INSUFFICIENT_BALANCE',
      message: 'Turbo credits are required for files over 100 KB.',
      cause,
      retry:   false,
      hint:    hint ?? 'Top up your Turbo balance at https://turbo.ardrive.io or use a funded wallet.',
    });
    this.name = 'ForgeBalanceError';
  }
}

export class ForgeTimeoutError extends ForgeError {
  constructor(cause = null) {
    super({
      code:    'TIMEOUT',
      message: 'The upload request timed out before Turbo responded.',
      cause,
      retry:   true,
      hint:    'Turbo may be under load. Retry in a few seconds.',
    });
    this.name = 'ForgeTimeoutError';
  }
}

export class ForgePaymentError extends ForgeError {
  constructor(message, hint = null) {
    super({
      code:  'PAYMENT_INVALID',
      message,
      cause: null,
      retry: false,
      hint,
    });
    this.name = 'ForgePaymentError';
  }
}

export class ForgePoolExistsError extends ForgeError {
  constructor(poolId) {
    super({
      code:    'POOL_EXISTS',
      message: `A pool for this token already exists on-chain: ${poolId}`,
      retry:   false,
      hint:    'Each token and SOL pair can only have one CPMM pool per fee tier. The existing poolId is attached to this error.',
    });
    this.name   = 'ForgePoolExistsError';
    this.poolId = poolId;
  }
}
