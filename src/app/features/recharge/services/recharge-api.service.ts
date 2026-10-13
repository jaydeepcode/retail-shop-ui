import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  CounterConfigResponse,
  CreateCustomerRequest,
  CreditCustomerResponse,
  DaySummaryResponse,
  HistoryPageResponse,
  HistoryQuery,
  MarkCompleteRequest,
  MarkFailedRequest,
  NumberHintResponse,
  PageResponse,
  RechargeResponse,
  RechargeWorkItemResponse,
  ServiceType,
  SettleBasketRequest,
  TransactionResponse,
  TvConnectionResponse
} from '../model/recharge.models';

/**
 * The 15 live endpoints of `RechargeController.java:105-495`, all under `/recharge`.
 *
 * `ApiService` is not reused here because it cannot set a request header, and
 * `POST /recharge/transactions` requires `Idempotency-Key` — omit it and the server
 * answers 400 (`RechargeController.java:208-214`).
 *
 * ⚠ Four of `design-api.md` §3.2's endpoints are NOT built and have no method here, so
 * no screen can accidentally call one: #12 retry, #13 refund, #14-#16 the credit book.
 *
 * ⚠ `POST /recharge/recharges/{id}/void` (#19) is deliberately absent too. The status
 * moves, which correctly drops the sale out of takings, but the reversing voucher is
 * not posted — `LedgerCorrectionRules` has no caller, which S2 left outstanding. Until
 * then the ledger overstates income after a void, so there is no method to call.
 */
@Injectable({ providedIn: 'root' })
export class RechargeApiService {
  private readonly base = `${environment.apiUrl}/recharge`;

  constructor(private http: HttpClient) {}

  // -- 1. Everything the counter needs before it can draw -------------------

  config(): Observable<CounterConfigResponse> {
    return this.http.get<CounterConfigResponse>(`${this.base}/config`);
  }

  // -- 2-4. The three lookups ----------------------------------------------

  /**
   * `known: false` is the ordinary answer until V15 runs, not an error — 88.5% of
   * mobile numbers are seen before in the legacy data, but none of it is in
   * `rc_recharge` yet.
   */
  numberHint(serviceType: ServiceType, numberToCheck: string): Observable<NumberHintResponse> {
    return this.http.get<NumberHintResponse>(
      `${this.base}/number-hints/${serviceType}/${encodeURIComponent(numberToCheck)}`
    );
  }

  /** Artboard 3's connection search. The server requires `query` to be 2 characters or more. */
  tvConnections(query: string, limit = 20): Observable<TvConnectionResponse[]> {
    return this.http.get<TvConnectionResponse[]>(`${this.base}/tv-connections`, {
      params: new HttpParams().set('query', query).set('limit', limit)
    });
  }

  searchCustomers(query: string, limit = 20): Observable<CreditCustomerResponse[]> {
    return this.http.get<CreditCustomerResponse[]>(`${this.base}/customers`, {
      params: new HttpParams().set('query', query).set('limit', limit)
    });
  }

  // -- 5. Naming a credit customer -----------------------------------------

  /**
   * 409 carries a `CreateCustomerRequestResult` naming the existing customer rather
   * than a bare error, so the counter can offer them instead of asking again.
   */
  createCustomer(request: CreateCustomerRequest): Observable<CreditCustomerResponse> {
    return this.http.post<CreditCustomerResponse>(`${this.base}/customers`, request);
  }

  // -- 6-7. Settling a basket ----------------------------------------------

  /**
   * ⚠ The same `idempotencyKey` twice returns 200 with the ORIGINAL transaction, not an
   * error. So one key is generated per basket, kept across retries, and changed only
   * when the basket changes — which is what makes a retry after a timeout safe.
   */
  settle(request: SettleBasketRequest, idempotencyKey: string): Observable<TransactionResponse> {
    return this.http.post<TransactionResponse>(`${this.base}/transactions`, request, {
      headers: { 'Idempotency-Key': idempotencyKey }
    });
  }

  transaction(paymentId: number): Observable<TransactionResponse> {
    return this.http.get<TransactionResponse>(`${this.base}/transactions/${paymentId}`);
  }

  // -- 8, 11. The two trays ------------------------------------------------

  /** Never filtered by financial year — anything open shows, whenever it started. */
  awaiting(page = 0, size = 20, operatorCode?: string, routeCode?: string):
    Observable<PageResponse<RechargeWorkItemResponse>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (operatorCode) {
      params = params.set('operatorCode', operatorCode);
    }
    if (routeCode) {
      params = params.set('routeCode', routeCode);
    }
    return this.http.get<PageResponse<RechargeWorkItemResponse>>(
      `${this.base}/recharges/awaiting`, { params }
    );
  }

  failures(page = 0, size = 20): Observable<PageResponse<RechargeWorkItemResponse>> {
    return this.http.get<PageResponse<RechargeWorkItemResponse>>(
      `${this.base}/recharges/failures`,
      { params: new HttpParams().set('page', page).set('size', size) }
    );
  }

  // -- 9-10. Answering "did it go through?" --------------------------------

  /**
   * One recharge at a time, deliberately. There is no bulk complete-all: it would let
   * recharge 3 failing roll back recharges 1 and 2 (§4.4). Three at once means three
   * calls and three outcomes.
   *
   * `routeCode` is the §14.6 override — the only moment a route can be chosen, because
   * this is the first moment anyone knows which connection was used.
   */
  complete(rechargeId: number, request: MarkCompleteRequest = {}): Observable<RechargeResponse> {
    return this.http.post<RechargeResponse>(
      `${this.base}/recharges/${rechargeId}/complete`, request
    );
  }

  /** A failed recharge consumes no float (§7.2:370), so there is no route to attribute. */
  fail(rechargeId: number, request: MarkFailedRequest = {}): Observable<RechargeResponse> {
    return this.http.post<RechargeResponse>(
      `${this.base}/recharges/${rechargeId}/fail`, request
    );
  }

  // -- 17. History ---------------------------------------------------------

  /** The only screen the financial-year filter touches — every other endpoint refuses it. */
  history(query: HistoryQuery = {}): Observable<HistoryPageResponse> {
    let params = new HttpParams()
      .set('page', query.page ?? 0)
      .set('size', query.size ?? 20);

    const optional: [keyof HistoryQuery, string | number | undefined][] = [
      ['financialYear', query.financialYear],
      ['number', query.number],
      ['operatorCode', query.operatorCode],
      ['routeCode', query.routeCode],
      ['status', query.status],
      ['staffId', query.staffId],
      ['reference', query.reference]
    ];
    for (const [key, value] of optional) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, value);
      }
    }

    return this.http.get<HistoryPageResponse>(`${this.base}/history`, { params });
  }

  // -- 18. The day summary the gate reads ----------------------------------

  /** @param date `YYYY-MM-DD`; omitted means today, which the server decides. */
  daySummary(date?: string): Observable<DaySummaryResponse> {
    const params = date ? new HttpParams().set('date', date) : undefined;
    return this.http.get<DaySummaryResponse>(`${this.base}/day-summary`, { params });
  }
}
