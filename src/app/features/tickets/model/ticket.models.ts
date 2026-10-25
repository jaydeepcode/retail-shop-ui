import {
  CreditCustomerResponse,
  SettlementLineRequest,
  SettlementMethod
} from '../../shared/payment/payment.models';

/**
 * The wire contract of the `/tickets` endpoints, mirrored field for field from the
 * records on `shop-backend` branch `s4/ticket-schema`.
 *
 * Mirrored by hand rather than generated, for the reason `recharge.models.ts` gives:
 * `design-api.md` §9.1 plans springdoc but no spec is published yet. Every type below
 * cites the record it copies so the two can be diffed when that spec arrives.
 *
 * ⚠ The settlement line types are NOT redeclared here. They come from
 * `shared/payment/payment.models.ts`, which is the point of S4's split: a ticket is
 * settled with the same lines against a different basket, so the lines are shared and
 * the basket is not (`next-session-s4.md` correction 2).
 *
 * ⚠ Amounts are `BigDecimal` on the server and arrive as JSON numbers. They are typed
 * as `number` here and never used to re-derive a figure the server already sent — the
 * total, the change and `changeDisplayed` are all server-owned.
 */

export type { CreditCustomerResponse, SettlementLineRequest, SettlementMethod };

/** `ticket/domain/BookingMode.java` — `ref_booking_mode`'s two codes (V31). */
export type BookingMode = 'RAIL' | 'BUS';

/**
 * `ticket/model/request/CreateBookingRequest.java`.
 *
 * ⚠ No total, no change and no flow. All three are server-owned or derived: the total
 * is `fareAmount + commissionAmount`, the change comes from the tender, and the flow is
 * read from whether a fare is present. `fundingAccountCode` is required exactly when
 * `fareAmount` is — `ck_tkt_funding` is the same rule in the database.
 */
export interface CreateBookingRequest {
  bookingMode: BookingMode;
  passengerCount: number;
  /** Omitted for flow 2 — the customer paid the platform themselves. */
  fareAmount?: number;
  commissionAmount: number;
  fundingAccountCode?: string;
  settlementLines: SettlementLineRequest[];
  note?: string;
}

/**
 * `ticket/model/response/SettlementLineResponse.java`.
 *
 * ⚠ `amountTendered`, `changeGiven` and `changeDisplayed` are `null` when a booking is
 * READ BACK rather than just created: the voucher records what was received, and
 * `tkt_booking` stores no tender or change. `changeDisplayed` is a tri-state for that
 * reason — `null` means "a re-read cannot say", which is different from `false`.
 */
export interface SettlementLineResponse {
  method: SettlementMethod;
  amount: number;
  amountTendered: number | null;
  changeGiven: number | null;
  changeDisplayed: boolean | null;
  reference: string | null;
  customerId: number | null;
  note: string | null;
}

/** `ticket/model/response/BookingResponse.java`. */
export interface BookingResponse {
  bookingId: number;
  bookingDttm: string;
  bookingMode: BookingMode;
  passengerCount: number;
  /** `null` ⇔ flow 2. Not zero: `ck_tkt_fare` refuses a zero fare. */
  fareAmount: number | null;
  commissionAmount: number;
  fundingAccountCode: string | null;
  /** The server's reading of the flow, so the screen never re-derives it. */
  shopFunded: boolean;
  totalDue: number;
  customerId: number | null;
  note: string | null;
  settlementLines: SettlementLineResponse[];
  voucherId: number | null;
}

/** `ticket/model/response/TicketDaySummaryResponse.java`. */
export interface TicketDaySummaryResponse {
  date: string;
  bookings: number;
  passengers: number;
  /** What the shop laid out on fares. Flow-2 bookings contribute nothing. */
  fareTotal: number;
  /** The margin — what ticketing actually earned. */
  commissionTotal: number;
  collectedTotal: number;
  byFundingAccount: FundingAccountTotal[];
}

export interface FundingAccountTotal {
  accountCode: string;
  bookings: number;
  fareTotal: number;
}

export interface TicketPageResponse {
  content: BookingResponse[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}

/**
 * The four accounts the shop funds tickets from, with the names the owner uses.
 *
 * ⚠ THE SERVER IS STILL THE AUTHORITY. `TicketBookingService.FUNDING_ACCOUNTS` holds the
 * same four and additionally refuses an inactive one, so a stale list here produces a
 * 422 rather than a bad booking. These labels exist because "BANK_SELF" is not what the
 * owner calls it — artboard 11 draws "My HDFC".
 *
 * There is no config endpoint for tickets yet; when there is, this list comes from it.
 */
export const FUNDING_ACCOUNTS: { code: string; label: string }[] = [
  { code: 'BANK_JANATA', label: 'Janata' },
  { code: 'BANK_SELF', label: 'My HDFC' },
  { code: 'BANK_WIFE', label: 'Wife HDFC' },
  { code: 'BANK_FATHER', label: 'Father SBI' }
];
