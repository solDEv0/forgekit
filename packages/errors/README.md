# @forgekit/errors

Canonical error classes for the forgekit toolkit. Every error carries a `code`, `message`, `hint`, `cause`, and `retry` flag so consumers can branch cleanly.

## Install

```bash
npm install @forgekit/errors
```

You normally do not install this directly. Every other forgekit package depends on it and re-exports the classes it uses.

## Usage

```js
import { ForgeValidationError, ForgeTxError } from '@forgekit/errors';

try {
  await someForgekitOperation();
} catch (err) {
  if (err instanceof ForgeValidationError) {
    console.error(err.message);
    console.error(err.hint);  // tells you exactly what to do
  }
  if (err.retry) {
    // safe to retry the same call as-is
  }
}
```

You can also branch on `err.code` or `err.name`, which work across package boundaries even if `instanceof` does not.

## Classes

| Class | Code | Retry |
|---|---|---|
| `ForgeError` | (base class) | varies |
| `ForgeValidationError` | `VALIDATION_ERROR` | false |
| `ForgeTxError` | `TX_FAILED` | true |
| `ForgeRpcError` | `RPC_ERROR` | true |
| `ForgeUploadError` | `UPLOAD_FAILED` | true |
| `ForgeBalanceError` | `INSUFFICIENT_BALANCE` | false |
| `ForgeTimeoutError` | `TIMEOUT` | true |
| `ForgePaymentError` | `PAYMENT_INVALID` | false |
| `ForgePoolExistsError` | `POOL_EXISTS` | false |

## License

MIT
