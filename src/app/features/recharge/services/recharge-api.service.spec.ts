import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../../environments/environment';
import { RechargeApiService } from './recharge-api.service';

describe('RechargeApiService', () => {
  let api: RechargeApiService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/recharge`;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    api = TestBed.inject(RechargeApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends the Idempotency-Key header on a settle, because the server 400s without one', () => {
    api
      .settle({ recharges: [], settlementLines: [] }, '9f2b7c1e-4d5a-4b8f-9c3e-1a2b3c4d5e6f')
      .subscribe();
    const request = http.expectOne(`${base}/transactions`);
    expect(request.request.headers.get('Idempotency-Key')).toBe(
      '9f2b7c1e-4d5a-4b8f-9c3e-1a2b3c4d5e6f'
    );
    request.flush({});
  });

  it('completes one recharge per call — there is no bulk endpoint to reach for', () => {
    expect((api as unknown as Record<string, unknown>)['completeAll']).toBeUndefined();
    api.complete(99051, { routeCode: 'A1TOPUP' }).subscribe();
    const request = http.expectOne(`${base}/recharges/99051/complete`);
    expect(request.request.body).toEqual({ routeCode: 'A1TOPUP' });
    request.flush({});
  });

  /**
   * ⚠ /void is WITHDRAWN ON THE SERVER as of 2026-10-21, not merely unwired — and the
   * reason this test gives changes with it, exactly as PR #5's four stale claims did.
   *
   * It was built, it worked, and it was removed (log §16.1): a void returned the money to
   * `RCHG_PENDING` and nothing could take it out again, because the residual mechanism
   * refuses any status but `FAILED` and `heldPending` has no date filter. This screen's
   * own refusal to wire it is what surfaced that, and the argument has moved from here
   * into the state machine, where `COMPLETED → VOIDED` no longer exists.
   *
   * Kept as an assertion rather than deleted, because the method would now 404 as well as
   * strand money: adding it back should trip a test, not ship a dead button.
   */
  it('exposes no void method — the endpoint was withdrawn, not left unwired', () => {
    expect((api as unknown as Record<string, unknown>)['void']).toBeUndefined();
    expect((api as unknown as Record<string, unknown>)['voidRecharge']).toBeUndefined();
  });

  /** ⚠ #16 is the one §3.2 endpoint still unbuilt, so it still has no method. */
  it('exposes no way to take a payment against a tab', () => {
    const surface = api as unknown as Record<string, unknown>;
    for (const name of ['settleCredit', 'creditPayment', 'payTab']) {
      expect(surface[name]).toBeUndefined();
    }
  });

  it('retries under the original payment, with no idempotency header', () => {
    api.retry(99051, { amount: 199, differenceSettlement: { mode: 'CASH' } }).subscribe();
    const request = http.expectOne(`${base}/recharges/99051/retry`);
    expect(request.request.body).toEqual({
      amount: 199,
      differenceSettlement: { mode: 'CASH' }
    });
    // ⚠ §7.2 guards #12 with V29's unique retry key INSTEAD of a key header, so sending
    // one would be the wrong mechanism — a double-click must reach the database and 409.
    expect(request.request.headers.has('Idempotency-Key')).toBe(false);
    request.flush({});
  });

  it('refunds the whole line, surcharge included', () => {
    api.refund(99051, { amount: 259, mode: 'CASH', customerId: null, note: null }).subscribe();
    const request = http.expectOne(`${base}/recharges/99051/refund`);
    expect(request.request.body).toEqual({
      amount: 259, mode: 'CASH', customerId: null, note: null
    });
    request.flush({});
  });

  /**
   * ⚠ ABSENT IS NOT ZERO on the credit book, and the two are different requests: absent
   * keeps `balance <> 0` and so keeps the customers who are in credit, while zero reads as
   * `balance <= 0` and drops them (`CreditBookRepository.java:88-94`).
   */
  it('leaves minOutstanding off the credit book rather than sending a zero', () => {
    api.creditBook().subscribe();
    const request = http.expectOne((r) => r.url === `${base}/credit/customers`);
    expect(request.request.params.has('minOutstanding')).toBe(false);
    request.flush({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
  });

  it('sends minOutstanding when a caller does ask for one', () => {
    api.creditBook(0).subscribe();
    const request = http.expectOne((r) => r.url === `${base}/credit/customers`);
    expect(request.request.params.get('minOutstanding')).toBe('0');
    request.flush({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
  });

  it('reads one person’s tab by customer id', () => {
    api.creditStatement(4821, 1).subscribe();
    const request = http.expectOne((r) => r.url === `${base}/credit/customers/4821`);
    expect(request.request.params.get('page')).toBe('1');
    request.flush({});
  });

  it('leaves blank history filters off the query string rather than sending empties', () => {
    api.history({ financialYear: '2026-27', number: '', operatorCode: undefined, page: 2 }).subscribe();
    const request = http.expectOne((r) => r.url === `${base}/history`);
    expect(request.request.params.get('financialYear')).toBe('2026-27');
    expect(request.request.params.has('number')).toBe(false);
    expect(request.request.params.has('operatorCode')).toBe(false);
    expect(request.request.params.get('page')).toBe('2');
    request.flush({});
  });

  it('asks the day summary for today by sending no date at all', () => {
    api.daySummary().subscribe();
    const request = http.expectOne((r) => r.url === `${base}/day-summary`);
    expect(request.request.params.has('date')).toBe(false);
    request.flush({});
  });

  it('never sends a financialYear to the worklist, which refuses the parameter', () => {
    api.awaiting(0, 20).subscribe();
    const request = http.expectOne((r) => r.url === `${base}/recharges/awaiting`);
    expect(request.request.params.has('financialYear')).toBe(false);
    request.flush({});
  });
});
