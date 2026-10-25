import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { errorSentence } from '../../recharge/services/recharge-error';
import { newIdempotencyKey } from '../../shared/idempotency-key';
import { RechargeApiService } from '../../recharge/services/recharge-api.service';
import { Tender, num } from '../../shared/payment/tender';
import {
  BookingMode,
  BookingResponse,
  CreateBookingRequest,
  FUNDING_ACCOUNTS
} from '../model/ticket.models';
import { TicketApiService } from '../services/ticket-api.service';

/**
 * Artboard 11 — booking a rail or bus ticket.
 *
 * <p>One screen and one transaction. There is no waiting state and nothing to come back
 * and confirm: the ticket is issued at the counter, which is the whole reason this posts
 * one voucher where recharge posts two.
 *
 * ⚠ "CUSTOMER PAID DIRECTLY" IS THE SAME CONTROL AS THE FUNDING PICKER, and a separate
 * flow toggle must not be added. Choosing who paid the platform IS choosing the flow:
 * picking "customer paid directly" clears the fare, which is what makes
 * `FARE_AMOUNT IS NULL` true, so the screen and `ck_tkt_funding` cannot disagree. Two
 * fields that can contradict each other is one field too many (T2, §7).
 *
 * ⚠ The payment block is `app-payment-panel` — the recharge counter's own component,
 * extracted in this slice's first commit rather than copied. "The same three buttons
 * would have been built twice and behaved differently" is the failure the design document
 * names, and sharing the component is what prevents it.
 */
@Component({
  selector: 'app-booking',
  templateUrl: './booking.component.html',
  styleUrl: './booking.component.scss'
})
export class BookingComponent implements OnInit, OnDestroy {

  readonly modes: { code: BookingMode; label: string }[] = [
    { code: 'RAIL', label: 'Rail' },
    { code: 'BUS', label: 'Bus' }
  ];

  readonly fundingAccounts = FUNDING_ACCOUNTS;

  mode: BookingMode = 'RAIL';
  passengersText = '1';

  /**
   * The funding account, or `null` for "customer paid directly".
   *
   * ⚠ ONE FIELD, holding both the account and the flow. `null` is not "nothing chosen
   * yet" — `customerPaidDirectly` tracks that separately — because the two states mean
   * different things to the request: one sends no fare, the other is not ready to send.
   */
  fundingAccountCode: string | null = null;
  customerPaidDirectly = false;

  fareText = '';
  commissionText = '60';
  /** Until the staff touch it, 60 × passengers is authoritative. */
  private commissionTouched = false;

  note = '';

  /** How the customer paid — the shared panel's state, which this screen owns. */
  readonly tender: Tender;

  booking = false;
  bookError = '';
  /** The booking just made, held so the screen can confirm it without clearing. */
  booked: BookingResponse | null = null;

  private readonly subscriptions = new Subscription();

  /**
   * One key per booking, kept across retries and replaced only when a booking is
   * actually made. Sending the same key twice returns the original rather than booking
   * twice, which is what makes a retry after a timeout safe.
   */
  private idempotencyKey = newIdempotencyKey();

  constructor(private api: TicketApiService, recharge: RechargeApiService) {
    this.tender = new Tender({
      // The customer book is shared with recharge — endpoints #4 and #5 are mounted
      // under /recharge but are not recharge's, and a ticket sold on credit names
      // somebody from the same 506 customers.
      directory: recharge,
      totalToMatch: () => this.totalDue,
      // ⚠ No ticket config endpoint yet, so §14.5's threshold is the same ₹5 the
      // recharge counter reads from rc_setting. Wiring both to one setting is a small
      // follow-up; inventing a second ticket-specific threshold would not be.
      changeThreshold: () => 5,
      onEdit: () => (this.bookError = ''),
      errorSentence,
      asExistingCustomer: () => null
    });
  }

  ngOnInit(): void {
    // Nothing to load: there is no ticket config endpoint, and the four funding
    // accounts are fixed by the chart of accounts rather than by configuration.
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.tender.destroy();
  }

  // =========================================================================
  // The booking
  // =========================================================================

  chooseMode(mode: BookingMode): void {
    this.mode = mode;
    this.bookError = '';
  }

  get passengers(): number {
    return Math.trunc(num(this.passengersText));
  }

  /**
   * ⚠ Commission DEFAULTS to 60 × passengers and stays editable.
   *
   * ₹60 per person is today's price, not a law — FY2026 already holds ₹3,435 and ₹2,160
   * on single bookings (§5). One keystroke for the common case, no rule for the uncommon
   * one. The server validates only that it is not negative.
   */
  onPassengersChange(value: string): void {
    this.passengersText = value;
    if (!this.commissionTouched) {
      this.commissionText = this.passengers > 0 ? String(this.passengers * 60) : '';
    }
    this.bookError = '';
  }

  onCommissionChange(value: string): void {
    this.commissionTouched = true;
    this.commissionText = value;
    this.bookError = '';
  }

  /**
   * The one control that is both the funding picker and the flow.
   *
   * Picking an account means the shop paid the platform and is owed the fare back; the
   * fare row appears. Picking "customer paid directly" clears the fare, which is what
   * makes `FARE_AMOUNT IS NULL` true server-side.
   */
  chooseFunding(code: string): void {
    this.fundingAccountCode = code;
    this.customerPaidDirectly = false;
    this.bookError = '';
  }

  customerPaid(): void {
    this.customerPaidDirectly = true;
    this.fundingAccountCode = null;
    // ⚠ Cleared, not merely hidden. A fare left in a hidden field would be sent, and
    // the server would refuse the booking with TICKET_FUNDING_MISMATCH — correctly,
    // and confusingly, because the screen would be showing no fare at all.
    this.fareText = '';
    this.bookError = '';
  }

  /** The fare row exists only when the shop funded the ticket. */
  get shopFunded(): boolean {
    return this.fundingAccountCode !== null;
  }

  get fareAmount(): number {
    return this.shopFunded ? num(this.fareText) : 0;
  }

  get commissionAmount(): number {
    return num(this.commissionText);
  }

  /**
   * What the customer pays, and the figure the tender must match.
   *
   * Computed here for display only. The server recomputes it from the same two fields
   * and refuses a tender that does not match, so the client cannot disagree with it —
   * and after the booking the screen reads the response's `totalDue`.
   */
  get totalDue(): number {
    const paise = Math.round(this.fareAmount * 100) + Math.round(this.commissionAmount * 100);
    return paise / 100;
  }

  /**
   * Whether the booking can be taken.
   *
   * ⚠ Every one of these is a 422 the server would return anyway. They are repeated here
   * so the button is dark rather than the refusal arriving after the customer has handed
   * over money — not because the screen is the authority for any of them.
   */
  get canBook(): boolean {
    if (this.booking) {
      return false;
    }
    if (this.passengers < 1) {
      return false;
    }
    if (this.commissionAmount < 0) {
      return false;
    }
    // The flow has to be chosen: neither an account nor "customer paid directly" means
    // the staff have not said who paid the platform.
    if (!this.shopFunded && !this.customerPaidDirectly) {
      return false;
    }
    if (this.shopFunded && this.fareAmount <= 0) {
      return false;
    }
    return this.tender.isReady;
  }

  takeBooking(): void {
    if (!this.canBook) {
      return;
    }
    this.booking = true;
    this.bookError = '';

    const request: CreateBookingRequest = {
      bookingMode: this.mode,
      passengerCount: this.passengers,
      commissionAmount: this.commissionAmount,
      settlementLines: this.tender.settlementLines()
    };
    // Omitted rather than sent as null, so a flow-2 booking carries neither field —
    // which is exactly what ck_tkt_funding asserts about the row.
    if (this.shopFunded) {
      request.fareAmount = this.fareAmount;
      request.fundingAccountCode = this.fundingAccountCode ?? undefined;
    }
    if (this.note.trim()) {
      request.note = this.note.trim();
    }

    this.subscriptions.add(
      this.api.create(request, this.idempotencyKey).subscribe({
        next: (booked) => {
          this.booking = false;
          this.booked = booked;
          this.startFresh();
        },
        error: (error) => {
          this.booking = false;
          // ⚠ The key is NOT replaced here. A refused booking may be refused for a
          // reason the staff can fix — a fare they forgot — and the retry must carry
          // the same key, or a timeout followed by a fix would book twice.
          this.bookError = errorSentence(error);
        }
      })
    );
  }

  /** Clears the form for the next customer, keeping the confirmation on screen. */
  private startFresh(): void {
    this.passengersText = '1';
    this.commissionText = '60';
    this.commissionTouched = false;
    this.fareText = '';
    this.fundingAccountCode = null;
    this.customerPaidDirectly = false;
    this.note = '';
    this.tender.reset();
    // A new booking is a new sale, so it gets its own key.
    this.idempotencyKey = newIdempotencyKey();
  }

  dismissConfirmation(): void {
    this.booked = null;
  }

  /** The funding account's own name, for the confirmation line. */
  labelFor(code: string | null): string {
    return this.fundingAccounts.find((a) => a.code === code)?.label ?? code ?? '';
  }
}
