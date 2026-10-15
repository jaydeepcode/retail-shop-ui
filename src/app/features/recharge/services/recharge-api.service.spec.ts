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
   * ⚠ /void exists on the backend and must NOT be reachable from a screen yet: the
   * status moves but the reversing voucher is not posted, so the ledger would overstate
   * income. Asserted so that adding the method back trips a test rather than shipping.
   */
  it('exposes no void method at all', () => {
    expect((api as unknown as Record<string, unknown>)['void']).toBeUndefined();
    expect((api as unknown as Record<string, unknown>)['voidRecharge']).toBeUndefined();
  });

  /** The four unbuilt endpoints have no methods, so no screen can call one by accident. */
  it('exposes no retry, refund or credit-book method', () => {
    const surface = api as unknown as Record<string, unknown>;
    for (const name of ['retry', 'refund', 'creditBook', 'creditCustomers', 'settleCredit']) {
      expect(surface[name]).toBeUndefined();
    }
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
