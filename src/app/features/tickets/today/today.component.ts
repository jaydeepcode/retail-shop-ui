import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { errorSentence } from '../../recharge/services/recharge-error';
import {
  BookingResponse,
  FUNDING_ACCOUNTS,
  TicketDaySummaryResponse
} from '../model/ticket.models';
import { TicketApiService } from '../services/ticket-api.service';

/**
 * Today — the day's bookings and what they came to.
 *
 * <p>⚠ A TALLY, NOT A QUEUE. Nothing here is waiting to be done: a booking is complete
 * the moment it is taken, which is why the tab's badge is green rather than amber. The
 * recharge worklist is a queue and looks like one; this must not borrow that shape or
 * the staff will read it as work outstanding.
 *
 * <p>⚠ The per-funding-account figures are the point, not decoration.
 * {@code CASH_TICKET} shares POOL-1 with {@code CASH_RECHARGE}, so once bookings post, a
 * cash difference at the evening count has two businesses in one drawer to be attributed
 * between. A day total alone would leave the owner unable to say which business a
 * variance came from — and the fares, which left four different bank accounts, unable to
 * be checked against any of them.
 */
@Component({
  selector: 'app-today',
  templateUrl: './today.component.html',
  styleUrl: './today.component.scss'
})
export class TodayComponent implements OnInit, OnDestroy {

  summary: TicketDaySummaryResponse | null = null;
  bookings: BookingResponse[] = [];
  loading = true;
  loadError = '';

  private readonly subscriptions = new Subscription();

  constructor(private api: TicketApiService) {}

  ngOnInit(): void {
    const today = new Date().toISOString().slice(0, 10);

    this.subscriptions.add(
      this.api.daySummary().subscribe({
        next: (summary) => (this.summary = summary),
        error: (error) => (this.loadError = errorSentence(error))
      })
    );

    this.subscriptions.add(
      this.api.bookings(today, today, undefined, undefined, 0, 50).subscribe({
        next: (page) => {
          this.bookings = page.content;
          this.loading = false;
        },
        error: (error) => {
          this.loading = false;
          this.loadError = errorSentence(error);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  /** The owner's name for an account; the code is not what they call it. */
  labelFor(code: string): string {
    return FUNDING_ACCOUNTS.find((a) => a.code === code)?.label ?? code;
  }

  modeLabel(booking: BookingResponse): string {
    return booking.bookingMode === 'RAIL' ? 'Railway' : 'Bus';
  }

  /** Stable identity, so refreshing does not re-create every row. */
  bookingKey(index: number, booking: BookingResponse): number {
    return booking.bookingId;
  }
}
