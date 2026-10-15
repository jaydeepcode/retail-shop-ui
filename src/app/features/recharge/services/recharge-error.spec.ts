import { HttpErrorResponse } from '@angular/common/http';
import { ErrorResponse } from '../model/recharge.models';
import {
  errorCode,
  errorSentence,
  firstBadRechargeIndex,
  isPossiblyExpiredSession
} from './recharge-error';

function failure(status: number, body: Partial<ErrorResponse> | null): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body });
}

describe('recharge-error', () => {
  it('reads the code, which is the contract, rather than the message', () => {
    const error = failure(422, {
      code: 'LINES_DO_NOT_SUM',
      message: 'anything at all — this wording may change freely',
      traceId: '7c1f9a3e',
      details: { expectedTotal: 429, providedTotal: 400 }
    });
    expect(errorCode(error)).toBe('LINES_DO_NOT_SUM');
    // Both totals come from `details`, so the counter can show the gap.
    expect(errorSentence(error)).toBe(
      'The payment lines add up to ₹400.00, but the basket comes to ₹429.00.'
    );
  });

  it('names the operator on NO_COMMISSION_RATE, in the words the session notes ask for', () => {
    const error = failure(422, {
      code: 'NO_COMMISSION_RATE',
      message: 'no rate',
      traceId: 'a',
      details: { operatorCode: 'BIGTV', routeCode: 'A1TOPUP' }
    });
    expect(errorSentence(error)).toBe(
      'BIGTV has no commission rate on file — add one to complete.'
    );
  });

  it('turns the two statuses of an illegal transition into plain words', () => {
    const error = failure(409, {
      code: 'ILLEGAL_STATUS_TRANSITION',
      message: 'illegal',
      traceId: 'a',
      details: { fromStatus: 'COMPLETED', toStatus: 'AWAITING_RECHARGE' }
    });
    expect(errorSentence(error)).toContain('already done');
    expect(errorSentence(error)).toContain('cannot be marked waiting');
  });

  it('falls back to the server message for a code it has no wording for', () => {
    const error = failure(409, {
      code: 'DUPLICATE_CUSTOMER_MOBILE',
      message: 'That mobile number is already on another customer.',
      traceId: 'a'
    });
    expect(errorSentence(error)).toBe('That mobile number is already on another customer.');
  });

  /**
   * ⚠ A 403 with no body of ours may be an expired session rather than a role problem:
   * SecurityConfig registers no AuthenticationEntryPoint, so the app answers 403 for both.
   */
  it('treats a bodiless 403 as possibly expired rather than forbidden', () => {
    const error = failure(403, null);
    expect(isPossiblyExpiredSession(error)).toBe(true);
    expect(errorSentence(error)).toContain('session may have expired');
    expect(errorSentence(error)).toContain('nothing was taken');
  });

  it('does not mistake a real 403 business error for an expired session', () => {
    const error = failure(403, { code: 'REASON_REQUIRED', message: 'reason', traceId: 'a' });
    expect(isPossiblyExpiredSession(error)).toBe(false);
  });

  it('says nothing was taken when the server was never reached', () => {
    expect(errorSentence(failure(0, null))).toContain('could not be reached');
  });

  it('finds the basket line a fieldErrors index path names', () => {
    const error = failure(400, {
      code: 'INVALID_REQUEST',
      message: 'bad',
      traceId: 'a',
      fieldErrors: [
        { field: 'settlementLines[0].amount', message: 'x' },
        { field: 'recharges[1].amount', message: 'an amount is at least 1.00' }
      ]
    });
    expect(firstBadRechargeIndex(error)).toBe(1);
  });

  it('returns no line when nothing points at one', () => {
    const error = failure(422, { code: 'INVALID_TENDER', message: 'x', traceId: 'a' });
    expect(firstBadRechargeIndex(error)).toBeNull();
  });
});
