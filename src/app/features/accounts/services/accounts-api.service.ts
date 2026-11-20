import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  ClosePreviewResponse,
  PoolCloseRequest,
  PoolCloseResponse,
  ReconciliationRequest,
  ReconciliationResponse,
  SharedConfigResponse,
  UpiPendingResponse,
  UpiSettlementRequest,
  UpiSettlementResponse
} from '../model/accounts.models';

/**
 * `AccountsController`'s endpoints 1-6, all under `/accounts`, plus the shared
 * `GET /config`.
 *
 * ⚠ **Endpoints 2 and 4 (the close) take no `Idempotency-Key`**, so this service sets no
 * header for either and the close screen does not mint a key — a close carries its own
 * identity, the key is derived server-side and `uk_recon_account_date` enforces it.
 * **Endpoint 6 is the opposite case**: A4 allows several settlements against one
 * collection date on purpose, so the server cannot tell a double-click from a second real
 * credit, and the client-generated key is what the UPI tab mints with
 * `newIdempotencyKey`. Endpoints 7, 8, 9 and 19 — `expenses` and `transfers` — need the
 * same generator and are still absent here.
 *
 * ⚠ Endpoints 7-9, 12 and 19 are deliberately absent. They are being built in parallel and
 * a method here that answers 404 would read as a wired screen.
 */
@Injectable({ providedIn: 'root' })
export class AccountsApiService {
  private readonly base = `${environment.apiUrl}/accounts`;

  constructor(private http: HttpClient) {}

  /** #1. Every pool with its members, every single reconcilable account. No parameters. */
  closePreview(): Observable<ClosePreviewResponse> {
    return this.http.get<ClosePreviewResponse>(`${this.base}/close-preview`);
  }

  /**
   * #2. The day close: records the count, posts the variance if any, sweeps the tills to
   * `CASH_SAFE`. One POST and one transaction.
   *
   * A **409** carries the original close rather than a bare error — see
   * {@link asReplayedClose}.
   */
  closePool(poolCode: string, request: PoolCloseRequest): Observable<PoolCloseResponse> {
    return this.http.post<PoolCloseResponse>(
      `${this.base}/pools/${encodeURIComponent(poolCode)}/closes`,
      request
    );
  }

  /**
   * #4. Closes a reconcilable account that is not in a pool.
   *
   * ⚠ `CASH_SAFE` closes here and nowhere else, although `V21:331` seeds it into cash pool
   * `SAFE`. The seed is what is wrong (ADR 0002), and `closePool` refuses `poolCode = SAFE`
   * with a 422 naming this endpoint — so the safe is never offered as a drawer.
   */
  closeAccount(
    accountCode: string,
    request: ReconciliationRequest
  ): Observable<ReconciliationResponse> {
    return this.http.post<ReconciliationResponse>(
      `${this.base}/${encodeURIComponent(accountCode)}/reconciliations`,
      request
    );
  }

  /** The shared settings read. Not `/recharge/config`, which carries operators and routes. */
  config(): Observable<SharedConfigResponse> {
    return this.http.get<SharedConfigResponse>(`${environment.apiUrl}/config`);
  }

  /**
   * #5. What is still in transit, grouped by collection date and aged.
   *
   * @param asOf `YYYY-MM-DD`; omitted means today, which the server decides.
   */
  upiPending(asOf?: string): Observable<UpiPendingResponse> {
    const params = asOf ? new HttpParams().set('asOf', asOf) : undefined;
    return this.http.get<UpiPendingResponse>(`${this.base}/upi-clearing/pending`, { params });
  }

  /**
   * #6. Records what the bank actually credited (A4).
   *
   * ⚠ Takes an `Idempotency-Key`, unlike #2 and #4 above — see `UpiSettlementRequest`. A
   * `409` carries the original settlement rather than a bare error, in the SAME shape as
   * a `201` — see {@link asReplayedUpiSettlement}.
   */
  settleUpi(
    request: UpiSettlementRequest,
    idempotencyKey: string
  ): Observable<UpiSettlementResponse> {
    return this.http.post<UpiSettlementResponse>(
      `${this.base}/upi-clearing/settlements`,
      request,
      { headers: { 'Idempotency-Key': idempotencyKey } }
    );
  }
}

/**
 * The settlement a 409 names, or `null` when this is not one.
 *
 * ⚠ Unlike {@link asReplayedClose}, there is no separate response shape to narrow to: a
 * replayed settlement comes back as the same `UpiSettlementResponse`, with `replayed: true`.
 * The `voucherId` check is just what tells this body apart from an `ErrorResponse`.
 */
export function asReplayedUpiSettlement(error: unknown): UpiSettlementResponse | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) {
    return null;
  }
  const body = error.error as UpiSettlementResponse | null;
  return body && typeof body === 'object' && typeof body.voucherId === 'number' ? body : null;
}

/**
 * The close a 409 names, or `null` when this is not one.
 *
 * ⚠ `POST /accounts/pools/{poolCode}/closes` answers 409 with a `PoolCloseResponse` — the
 * close that already exists — rather than with the usual `ErrorResponse`. The precedent is
 * `POST /recharge/customers`, which answers a duplicate mobile with the existing customer
 * for the same reason, and `PoolCloseResponse.java:17-25` gives it: "a bare 409 leaves the
 * operator stuck with a drawer in front of them and no figures."
 *
 * So a replay is **not** an error on this screen. It is the answer, and it is shown as one.
 */
export function asReplayedClose(error: unknown): PoolCloseResponse | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) {
    return null;
  }
  const body = error.error as PoolCloseResponse | null;
  return body && typeof body === 'object' && typeof body.poolCode === 'string' ? body : null;
}

/** The same, for a single account's close through endpoint 4. */
export function asReplayedAccountClose(error: unknown): ReconciliationResponse | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) {
    return null;
  }
  const body = error.error as ReconciliationResponse | null;
  return body && typeof body === 'object' && typeof body.reconId === 'number' ? body : null;
}
