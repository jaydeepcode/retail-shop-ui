import { HttpErrorResponse } from '@angular/common/http';
import { ErrorCode, ErrorResponse } from '../model/recharge.models';

/**
 * Reading `/recharge`'s one error shape (`response/ErrorResponse.java`).
 *
 * ⚠ Switch on `code`, never on `message`. `exception/ErrorCode.java` is blunt about
 * why: "a keyboard-driven counter has to decide WHERE TO PUT THE CURSOR when a settle
 * is refused, and it cannot do that from prose." `message` may be reworded freely.
 */

/** The body of a `/recharge` failure, or `null` when the response was not one of ours. */
export function errorBody(error: unknown): ErrorResponse | null {
  if (!(error instanceof HttpErrorResponse)) {
    return null;
  }
  const body = error.error as ErrorResponse | null;
  return body && typeof body === 'object' && typeof body.code === 'string' ? body : null;
}

export function errorCode(error: unknown): ErrorCode | null {
  return errorBody(error)?.code ?? null;
}

/**
 * ⚠ A 403 on `/recharge/**` may mean the session expired, not "permanently forbidden".
 *
 * `design-api.md` §3.2 specifies 401 for a missing or expired token, but `SecurityConfig`
 * registers no `AuthenticationEntryPoint`, so the app returns 403 for both "not logged
 * in" and "wrong role" — recorded in `RechargeSecurityTest.anonymousIsRefused`. Changing
 * the backend was declined on purpose: it would move the response of every endpoint the
 * water mobile app calls. It is open item 4 of next-session-s3-screens.md.
 *
 * `AuthInterceptor.ts:33` already does the right thing with it — a 403 triggers a token
 * refresh and one retry, and only a failed refresh logs out. So a 403 that reaches a
 * screen has already survived that, and the screen says so rather than claiming a
 * permission problem it cannot distinguish.
 */
export function isPossiblyExpiredSession(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 403 && errorBody(error) === null;
}

/**
 * The sentence to show the operator.
 *
 * Only the codes a counter has to handle by name get their own wording; everything else
 * falls back to the server's `message`, which is written for humans and is better than
 * anything a client could invent from a code it does not know.
 */
export function errorSentence(error: unknown): string {
  if (isPossiblyExpiredSession(error)) {
    return 'Your session may have expired. Sign in again and retry — nothing was taken.';
  }

  const body = errorBody(error);
  if (!body) {
    return error instanceof HttpErrorResponse && error.status === 0
      ? 'The server could not be reached. Nothing was taken — check the connection and retry.'
      : 'Something went wrong. Nothing was taken.';
  }

  const details = body.details ?? {};
  switch (body.code) {
    case 'LINES_DO_NOT_SUM':
      return `The payment lines add up to ${money(details['providedTotal'])}, but the basket `
        + `comes to ${money(details['expectedTotal'])}.`;

    case 'CREDIT_REQUIRES_CUSTOMER':
      return 'A credit line needs a named customer.';

    case 'TOO_MANY_CREDIT_LINES':
      return 'Only one credit line is allowed on a payment.';

    case 'INVALID_TENDER':
      return `Cash taken (${money(details['amountTendered'])}) is less than the cash line `
        + `(${money(details['cashLineAmount'])}).`;

    case 'ILLEGAL_STATUS_TRANSITION':
      return `This recharge is already ${statusWord(details['fromStatus'])} — `
        + `it cannot be marked ${statusWord(details['toStatus'])}. Refresh and look again.`;

    case 'NO_COMMISSION_RATE':
      // The exact sentence next-session-s3-screens.md asks for.
      return `${details['operatorCode'] ?? 'This operator'} has no commission rate on file`
        + ' — add one to complete.';

    case 'REASON_REQUIRED':
      return 'A reason is required.';

    case 'CUSTOMER_NOT_FOUND':
      return 'That customer no longer exists. Search for them again.';

    case 'FAILURE_ALREADY_RESOLVED':
      return 'Someone has already sorted this failure out. Refresh and look again.';

    case 'CONCURRENT_MODIFICATION':
      return 'Someone else changed this at the same moment. Refresh and retry.';

    default:
      return body.message;
  }
}

/**
 * The field a `fieldErrors` entry points at, as the counter's own path.
 *
 * `fieldErrors` carries index paths like `recharges[1].amount`, which is what lets the
 * screen put the cursor on the right line rather than on the first one.
 */
export function fieldErrorsByPath(error: unknown): Map<string, string> {
  const byPath = new Map<string, string>();
  for (const entry of errorBody(error)?.fieldErrors ?? []) {
    if (!byPath.has(entry.field)) {
      byPath.set(entry.field, entry.message);
    }
  }
  return byPath;
}

/** The basket index a `fieldErrors` path names, or `null` when it names no line. */
export function firstBadRechargeIndex(error: unknown): number | null {
  for (const field of fieldErrorsByPath(error).keys()) {
    const match = /^recharges\[(\d+)\]/.exec(field);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}

function money(value: unknown): string {
  return typeof value === 'number' ? `₹${value.toFixed(2)}` : '—';
}

function statusWord(value: unknown): string {
  switch (value) {
    case 'AWAITING_RECHARGE':
      return 'waiting';
    case 'COMPLETED':
      return 'done';
    case 'FAILED':
      return 'failed';
    case 'VOIDED':
      return 'voided';
    case 'RETRIED':
      return 'retried';
    case 'REFUNDED':
      return 'refunded';
    default:
      return String(value ?? 'in another state');
  }
}
