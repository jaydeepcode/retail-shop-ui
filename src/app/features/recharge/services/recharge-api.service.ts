import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  CounterConfigResponse,
  CreateCustomerRequest,
  CreditBookRowResponse,
  CreditCustomerResponse,
  CreditStatementResponse,
  DaySummaryResponse,
  HistoryPageResponse,
  HistoryQuery,
  MarkCompleteRequest,
  MarkFailedRequest,
  NumberHintResponse,
  PageResponse,
  RechargeResponse,
  RechargeWorkItemResponse,
  RefundRechargeRequest,
  RefundResponse,
  RetryRechargeRequest,
  RetryRechargeResponse,
  ServiceType,
  SettleBasketRequest,
  TransactionResponse,
  TvConnectionResponse
} from '../model/recharge.models';

/**
 * The live endpoints of `RechargeController.java`, all under `/recharge`.
 *
 * `ApiService` is not reused here because it cannot set a request header, and
 * `POST /recharge/transactions` requires `Idempotency-Key` — omit it and the server
 * answers 400 (`RechargeController.java:233-245`).
 *
 * ⚠ One of `design-api.md` §3.2's endpoints is still unbuilt and so has no method here:
 * **#16, taking a payment against a tab.** It is deferred to S6 with its design settled
 * in `implementation-plan.md` §0.7 — a receipt must clear the customer's `AR_*` legs
 * oldest-first, each naming its own business, and the ledger does not hold legacy debt
 * until the opening balances land (V30/V31). A tally-first version would post water debt
 * to `AR_RECHARGE`, so the credit book below READS and does not collect.
 *
 * ⚠ `POST /recharge/recharges/{id}/void` (#19) IS GONE FROM THE SERVER as of 2026-10-21,
 * and the reason this comment gives has changed with it. It is no longer "built but unsafe
 * to wire" — it is WITHDRAWN (log §16.1), and `design-api.md` §3.2 strikes the row through.
 *
 * Why, because it is the same argument this file used to make for not wiring it: a void
 * STRANDED the customer's money. It returned the amount to `RCHG_PENDING` and said §7.4's
 * residual mechanism settles it from there — and that mechanism refuses any status but
 * `FAILED`, while `heldPending` has no date filter, so the amount would have sat on the
 * day summary for good. The screens found it; the backend removed the path rather than
 * leaving a button nobody could safely press.
 *
 * The correction that works is `COMPLETED → FAILED` — which posts the identical reversal —
 * and then `refund`, both of which this service exposes. There is nothing left to wire,
 * and `RechargeStatus.VOIDED` survives only as a status that is defined, terminal and
 * unreachable, so a row from any source still renders.
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

  // -- 12-13. Resolving a failure ------------------------------------------

  /**
   * Retry a failed recharge under the ORIGINAL payment (#12).
   *
   * ⚠ NO `Idempotency-Key`, and that is §7.2's decision rather than an omission: #12
   * "is guarded by the unique retry key", which V29 adds. So a double-click reaches the
   * database and is refused there as **409 `DUPLICATE_RETRY`** (or
   * `FAILURE_ALREADY_RESOLVED`) — which the screen should read as "someone already did
   * this; refresh", never as an error to retry.
   */
  retry(rechargeId: number, request: RetryRechargeRequest): Observable<RetryRechargeResponse> {
    return this.http.post<RetryRechargeResponse>(
      `${this.base}/recharges/${rechargeId}/retry`, request
    );
  }

  /**
   * Hand a failed recharge's money back (#13).
   *
   * ⚠ `amount` is the whole line total including surcharge — a partial refund is a 422,
   * because `REFUNDED` is terminal and the remainder could never be resolved.
   */
  refund(rechargeId: number, request: RefundRechargeRequest): Observable<RefundResponse> {
    return this.http.post<RefundResponse>(
      `${this.base}/recharges/${rechargeId}/refund`, request
    );
  }

  // -- 14-15. The credit book ----------------------------------------------

  /**
   * Who owes the shop money, oldest debt first (#14).
   *
   * ⚠ `minOutstanding` ABSENT is not the same as zero, so it is only ever set when a
   * caller passes one: absent keeps the customers who are in credit, zero drops them.
   */
  creditBook(minOutstanding?: number, page = 0, size = 20):
    Observable<PageResponse<CreditBookRowResponse>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (minOutstanding !== undefined && minOutstanding !== null) {
      params = params.set('minOutstanding', minOutstanding);
    }
    return this.http.get<PageResponse<CreditBookRowResponse>>(
      `${this.base}/credit/customers`, { params }
    );
  }

  /**
   * One person's tab, newest first, from every business (#15).
   *
   * A 404 rather than an empty statement for an unknown customer or a ledger
   * pseudo-customer, because an empty statement reads as "owes nothing" (§2.6).
   */
  creditStatement(customerId: number, page = 0, size = 50): Observable<CreditStatementResponse> {
    return this.http.get<CreditStatementResponse>(
      `${this.base}/credit/customers/${customerId}`,
      { params: new HttpParams().set('page', page).set('size', size) }
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
