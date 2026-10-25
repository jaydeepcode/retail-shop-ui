import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  BookingMode,
  BookingResponse,
  CreateBookingRequest,
  TicketDaySummaryResponse,
  TicketPageResponse
} from '../model/ticket.models';

/**
 * The four live endpoints of `TicketController.java`, all under `/tickets`.
 *
 * `ApiService` is not reused here for the reason `RechargeApiService` gives: it cannot
 * set a request header, and `POST /tickets/bookings` requires `Idempotency-Key` —
 * omit it and the server answers 400.
 *
 * ⚠ There is no `PUT` and no `DELETE`, and that is the design rather than an omission.
 * Corrections go through FRD §8.3, already implemented by the ledger's trigger 4: before
 * the account's reconciliation point the voucher is deleted and re-posted, and after it a
 * `JOURNAL`. A ticket-specific edit endpoint would need its own copy of that rule.
 */
@Injectable({ providedIn: 'root' })
export class TicketApiService {
  private readonly base = `${environment.apiUrl}/tickets`;

  constructor(private http: HttpClient) {}

  /**
   * #1 — the one atomic write: the booking and its voucher in one transaction.
   *
   * ⚠ The same `idempotencyKey` twice returns 200 with the ORIGINAL booking, not an
   * error. So one key is generated per booking, kept across retries, and changed only
   * when the booking itself changes — which is what makes a retry after a timeout safe
   * rather than a second sale.
   */
  create(request: CreateBookingRequest, idempotencyKey: string): Observable<BookingResponse> {
    return this.http.post<BookingResponse>(`${this.base}/bookings`, request, {
      headers: { 'Idempotency-Key': idempotencyKey }
    });
  }

  /** #2. Also the replay's return, so it carries the voucher and the tender. */
  booking(bookingId: number): Observable<BookingResponse> {
    return this.http.get<BookingResponse>(`${this.base}/bookings/${bookingId}`);
  }

  /** #3. `from` and `to` are `YYYY-MM-DD`; `to` covers its whole day. */
  bookings(from: string, to: string, mode?: BookingMode, fundingAccount?: string,
           page = 0, size = 20): Observable<TicketPageResponse> {
    let params = new HttpParams().set('from', from).set('to', to)
      .set('page', page).set('size', size);
    if (mode) {
      params = params.set('mode', mode);
    }
    if (fundingAccount) {
      params = params.set('fundingAccount', fundingAccount);
    }
    return this.http.get<TicketPageResponse>(`${this.base}/bookings`, { params });
  }

  /** #4. @param date `YYYY-MM-DD`; omitted means today, which the server decides. */
  daySummary(date?: string): Observable<TicketDaySummaryResponse> {
    const params = date ? new HttpParams().set('date', date) : undefined;
    return this.http.get<TicketDaySummaryResponse>(`${this.base}/day-summary`, { params });
  }
}
