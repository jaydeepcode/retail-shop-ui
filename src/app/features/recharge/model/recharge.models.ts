/**
 * The wire contract of the `/recharge` endpoints, mirrored field for field from the
 * records on `shop-backend` branch `s3/recharge-counter`.
 *
 * Mirrored by hand rather than generated: `design-api.md` §9.1 plans springdoc and
 * next-session-web-shell.md's "where the two sessions meet" asks for generation from
 * one spec, but no spec is published yet. Every type below cites the record it copies
 * so the two can be diffed when that spec arrives.
 *
 * ⚠ Amounts are `BigDecimal` on the server and arrive as JSON numbers. They are typed
 * as `number` here and never used to re-derive a figure the server already sent — the
 * total, the change, the `warn` flag and `changeDisplayed` are all server-owned
 * (next-session-s3-screens.md, "what this session must not do").
 */

/** `domain/ServiceType.java` — `ref_recharge_kind`'s two codes. */
export type ServiceType = 'MOBILE' | 'TV';

/**
 * `domain/SettlementMethod.java`. The wire name differs from the column for credit:
 * the API says `CREDIT`, `rc_txn_payment.LINE_TYPE` holds `CRDT`. The mapping is the
 * server's; a screen only ever sees the wire name.
 */
export type SettlementMethod = 'CASH' | 'UPI' | 'CREDIT';

/**
 * `domain/RechargeStatus.java`, as it reaches the wire through
 * `FailureResolution.wireStatus` — so `RETRIED` and `REFUNDED` never appear here.
 * They arrive as `FAILED` carrying a `resolution`.
 */
export type RechargeStatus = 'AWAITING_RECHARGE' | 'COMPLETED' | 'FAILED' | 'VOIDED';

/** `domain/FailureResolution.java` — derived server-side, never stored. */
export type FailureResolution = 'NONE' | 'RETRIED' | 'REFUNDED';

/**
 * `domain/ResidualMode.java` — the three ways money can leave `RCHG_PENDING`.
 *
 * ⚠ NOT a `SettlementMethod` and not interchangeable with one. A settlement method is
 * how money came IN; a residual mode is how it goes back OUT. The two lists now line up
 * on all three rails, and they did not before: until 2026-10-21 there was no `UPI` here,
 * so a UPI-only payment could be settled only as `KEEP_AS_ADVANCE`.
 *
 * ⚠ `KEEP_AS_ADVANCE` IS WITHDRAWN, and `UPI` is what made that safe (log §16.2). The
 * old mode was a one-way door: it credited `ADV_RECHARGE`, nothing debits that account,
 * `SettlementMethod` has no `ADVANCE` member to draw it down, and the credit book reads
 * the `rc_credit_req` tally so it could not see the money either. The liability changed
 * shape instead of leaving — observed live on 2026-10-19 as ₹250 kept against an
 * `advanceHeld` of 0.00 and an empty statement. Each original now has a route home by
 * the rail it arrived on: cash hands cash back, credit reduces the tab, UPI refunds by
 * UPI.
 *
 * Which modes are AVAILABLE is a fact about the original payment and never a choice —
 * `RechargeFailureResolutionService.resolveResidual` derives it from that payment's
 * tender lines, one mode per line type, with no unconditional fallback any more. A 422
 * `REFUND_MODE_NOT_AVAILABLE` carries the list in `details.available`.
 *
 * ⚠ `UPI` REQUIRES THE NOTE, which carries the UPI transaction reference — a 422
 * `UPI_REQUIRES_REFERENCE` otherwise. `UPI_CLEARING` is reconcilable, so the outgoing
 * amount surfaces when UPI is reconciled against the bank, and the reference is the only
 * trace from that line back to the actual transfer.
 */
export type ResidualMode = 'CASH' | 'UPI' | 'CREDIT_REDUCTION';

/**
 * `exception/ErrorCode.java`. These names are the contract: §8.4 says `message` may be
 * reworded freely and `code` may not, because a keyboard-driven counter has to decide
 * where to put the cursor and cannot do that from prose.
 */
export type ErrorCode =
  // 400
  | 'INVALID_REQUEST'
  | 'INVALID_FINANCIAL_YEAR'
  // 404
  | 'RECHARGE_NOT_FOUND'
  | 'PAYMENT_NOT_FOUND'
  | 'CUSTOMER_NOT_FOUND'
  | 'UNKNOWN_OPERATOR'
  | 'UNKNOWN_ROUTE'
  // 409
  | 'ILLEGAL_STATUS_TRANSITION'
  | 'FAILURE_ALREADY_RESOLVED'
  | 'DUPLICATE_RETRY'
  | 'CONCURRENT_MODIFICATION'
  | 'DUPLICATE_CUSTOMER_MOBILE'
  | 'DATA_INTEGRITY_VIOLATION'
  // 422
  | 'LINES_DO_NOT_SUM'
  | 'CREDIT_REQUIRES_CUSTOMER'
  /**
   * 422 on a UPI refund with no transaction reference in `note`. Separate from
   * `REFUND_MODE_NOT_AVAILABLE` because the mode IS available and it is the note field
   * that is wrong — which is where §8.4 says the cursor goes.
   */
  | 'UPI_REQUIRES_REFERENCE'
  | 'INVALID_TENDER'
  | 'UNSETTLED_DIFFERENCE'
  | 'REFUND_MODE_NOT_AVAILABLE'
  | 'TOO_MANY_CREDIT_LINES'
  | 'NO_COMMISSION_RATE'
  /**
   * 422 on COMPLETION: this operator and route do not resolve to a wallet the shop holds.
   * Raised for a route with no rule (`SARAVATE`) and for a `DIRECT` pairing with an
   * operator that has no direct connection — BSNL and every TV operator (§2.4:86). The
   * staff can act on it by choosing another route, so the screen points at that control.
   */
  | 'FLOAT_ACCOUNT_NOT_DERIVABLE'
  // ⚠ 'REASON_REQUIRED' was removed on 2026-10-21: its one emitter was #19's void path,
  // whose mandatory reason went with the endpoint. #10's reason is optional.
  // 500
  | 'INTERNAL_ERROR';

/** `response/ErrorResponse.java`. One shape for every failure on this surface. */
export interface ErrorResponse {
  code: ErrorCode;
  message: string;
  traceId: string;
  /** Index paths like `recharges[1].amount`, which is what puts the cursor on a line. */
  fieldErrors?: { field: string; message: string }[];
  /** Machine-usable numbers: both totals on `LINES_DO_NOT_SUM`, the two statuses on an illegal move. */
  details?: Record<string, unknown>;
}

/** `response/CounterConfigResponse.java` — everything the counter needs before it can draw. */
export interface CounterConfigResponse {
  operators: OperatorConfig[];
  routes: RouteConfig[];
  creditWarningDays: number;
  fyStartMonth: number;
  /** e.g. `2026-27`. Authoritative — the browser must not derive it. */
  currentFinancialYear: string;
  /** `rc_setting['change.display.threshold']` (§14.5). Read, never hard-coded. */
  changeDisplayThreshold: number;
  surchargeDefaultTv: number;
  surchargeDefaultMobile: number;
}

export interface OperatorConfig {
  code: string;
  name: string;
  serviceType: ServiceType;
  defaultRouteCode: string;
  /**
   * ⚠ Legitimately empty, and empty is an answer, not a loading state. TV operators
   * have none at all — §14.10 measured Dish TV's commonest amount at 16% of its volume
   * against mobile's 78% — and Vi has none either, which is open item 1 of
   * next-session-s3-screens.md. An operator with no presets gets a bare amount field.
   */
  presets: number[];
}

export interface RouteConfig {
  code: string;
  name: string;
}

/** `response/RechargeResponse.java`. */
export interface RechargeResponse {
  rechargeId: number;
  reference: string;
  serviceType: ServiceType;
  number: string;
  operatorCode: string;
  operatorName: string;
  routeCode: string;
  routeName: string;
  /** Server-derived as `status !== AWAITING_RECHARGE` — the route is fixed at completion (§14.6). */
  routeConfirmed: boolean;
  amount: number;
  surcharge: number;
  status: RechargeStatus;
  resolution: FailureResolution;
  vendorRef: string | null;
  retryOfRechargeId: number | null;
  failureReason: string | null;
  rechargeAt: string;
  statusChangedAt: string;
}

/** `response/SettlementLineResponse.java`. */
export interface SettlementLineResponse {
  lineId: number;
  method: SettlementMethod;
  amount: number;
  amountTendered: number | null;
  changeGiven: number | null;
  /**
   * ⚠ Trust this flag; never re-derive it from `changeGiven` and the threshold.
   * §14.5 keeps change under ₹5 off the screen entirely, and the rule lives server-side
   * so two clients cannot disagree about it.
   */
  changeDisplayed: boolean;
  reference: string | null;
  customerId: number | null;
  customerName: string | null;
  extendedBy: string | null;
  note: string | null;
}

/** `response/CreditSummaryResponse.java` — the panel that warns before a credit sale commits. */
export interface CreditSummaryResponse {
  customerId: number | null;
  customerName: string | null;
  amountExtended: number;
  outstandingAfter: number;
  /** §14.8's mirror rule: a charge consumes any advance first, then becomes debt. */
  advanceHeld: number;
  oldestDebtDays: number | null;
  /** Computed from the 30-day rule server-side, so two clients cannot disagree. */
  warn: boolean;
}

/** `response/TransactionResponse.java` — what a settled basket comes back as. */
export interface TransactionResponse {
  paymentId: number;
  paymentReference: string;
  takenAt: string;
  staff: string;
  financialYear: string;
  totalDue: number;
  totalSurcharge: number;
  cashTendered: number | null;
  changeDue: number | null;
  recharges: RechargeResponse[];
  settlementLines: SettlementLineResponse[];
  credit: CreditSummaryResponse | null;
}

/** `response/RechargeWorkItemResponse.java` — a row of the leftover tray. */
export interface RechargeWorkItemResponse {
  rechargeId: number;
  reference: string;
  serviceType: ServiceType;
  number: string;
  operatorCode: string;
  operatorName: string;
  routeCode: string;
  amount: number;
  surcharge: number;
  rechargeAt: string;
  /** Present here but NOT on `RechargeResponse` — see the note on `HistoryPageResponse`. */
  paymentId: number;
  failureReason: string | null;
}

/** `response/NumberHintResponse.java`. */
export interface NumberHintResponse {
  /**
   * ⚠ `false` for every number until V15 runs at cutover, because `rc_recharge` is
   * empty until then. So "unknown" is the ordinary case and must not read as an error
   * (§15.11 item 2).
   */
  known: boolean;
  operatorCode: string | null;
  routeCode: string | null;
  lastAmount: number | null;
  lastRechargeAt: string | null;
  dishtvNo: string | null;
}

/** `response/TvConnectionResponse.java` — a row of `rc_dishtv_dtls` (458 of them). */
export interface TvConnectionResponse {
  connectionNumber: string;
  operatorCode: string;
  name: string;
  contactNumber: string;
}

/** `response/CreditCustomerResponse.java`. */
export interface CreditCustomerResponse {
  customerId: number;
  name: string;
  contactNumber: string;
  outstanding: number;
  advanceHeld: number;
  oldestDebtDays: number | null;
  warn: boolean;
}

/** `response/CreateCustomerRequestResult.java` — the 409 body when the mobile is taken. */
export interface CreateCustomerRequestResult {
  existingCustomerId: number;
  name: string;
  contactNumber: string;
}

/** `response/PageResponse.java`. */
export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

/**
 * `response/HistoryPageResponse.java`.
 *
 * ⚠ `availableYears: []` is the signal that nothing has been recorded yet, which needs
 * a different sentence from "no results for this filter". `/recharge/history` reads
 * `rc_recharge` alone (§15.11 item 2) and that table is empty until V15 runs at
 * cutover, so a blank screen on day one is correct rather than broken.
 *
 * ⚠ Its rows are `RechargeResponse`, which carries no `paymentId` and no settlement
 * lines — so artboard 7's `Payment` and `Paid by` columns cannot be filled from this
 * endpoint, and its footer totals (value, our charges) are not here either. The screen
 * is built per recharge instead. Reported rather than worked around, per the rule that
 * a disagreement between the artboards and the documents gets stated.
 */
export interface HistoryPageResponse {
  financialYear: string;
  startDate: string;
  endDate: string;
  availableYears: string[];
  page: PageResponse<RechargeResponse>;
}

/**
 * `response/RetryRechargeResponse.java` — both halves of a retry, in one payload.
 *
 * ⚠ Carries BOTH recharges on purpose, so the screen can drop the failure off the
 * failures tray and put the new attempt on the worklist without a second read.
 *
 * Exactly one of the two settlement pairs is populated, and on an equal-amount retry
 * neither is: `differenceOwed`/`differenceSettledAs` when the new amount is lower,
 * `topUpTaken`/`topUpTakenAs` when it is higher.
 */
export interface RetryRechargeResponse {
  newRecharge: RechargeResponse;
  originalRecharge: RechargeResponse;
  differenceOwed: number | null;
  differenceSettledAs: ResidualMode | null;
  topUpTaken: number | null;
  topUpTakenAs: SettlementMethod | null;
  /** Present when the difference or the top-up touched someone's tab. */
  credit: CreditSummaryResponse | null;
}

/** `response/RefundResponse.java`. */
export interface RefundResponse {
  recharge: RechargeResponse;
  amount: number;
  mode: ResidualMode;
  /** Present for `CREDIT_REDUCTION`, the one mode that names a customer. */
  credit: CreditSummaryResponse | null;
}

/**
 * `response/CreditBookRowResponse.java` — one person on the credit book (#14).
 *
 * ⚠ `outstanding` and `advanceHeld` are BOTH POSITIVE and only one is ever non-zero.
 * This is one netted position, shown as "owes ₹120" or "has ₹80 with us" — never as two
 * numbers side by side.
 *
 * ⚠ The figure is ACROSS EVERY BUSINESS and never year-filtered (log §14.8). Someone
 * owing ₹2,000 on water and ₹49 on recharge shows ₹2,049, because a recharge-scoped
 * figure would make `warn` understate the exposure while looking authoritative.
 */
export interface CreditBookRowResponse {
  customerId: number;
  name: string;
  contactNumber: string;
  outstanding: number;
  advanceHeld: number;
  /** Null when nothing is owed. Server-computed; never re-derived here. */
  oldestDebtDays: number | null;
  /** The 30-day rule, applied server-side so two clients cannot disagree. */
  warn: boolean;
  lastActivityAt: string;
}

/** `response/CreditStatementResponse.StatementLineResponse.java` — one line of a tab. */
export interface StatementLineResponse {
  creditRequestId: number;
  at: string;
  /** Free text from the server; `type` is not a closed enum on the wire. */
  type: string;
  amount: number;
  /** The one SIGNED figure in this API. Everything else is a positive magnitude. */
  runningBalance: number;
  note: string | null;
  /**
   * ⚠ Null on every historical row, and that is ORDINARY rather than missing data:
   * §8.8 found that no record of who extended a legacy credit exists anywhere. Render
   * its absence plainly; do not draw an empty slot for it.
   */
  extendedBy: string | null;
  paymentId: number | null;
}

/**
 * `response/CreditStatementResponse.java` — one person's tab, newest first (#15).
 *
 * The header figures come from the same `positionOf` the counter's credit panel uses,
 * so what a staff member sees here cannot disagree with what they saw taking the sale.
 */
export interface CreditStatementResponse {
  customerId: number;
  name: string;
  contactNumber: string;
  outstanding: number;
  advanceHeld: number;
  oldestDebtDays: number | null;
  warn: boolean;
  lines: PageResponse<StatementLineResponse>;
}

/**
 * `response/DaySummaryResponse.java` — what the slice's gate reads
 * (`implementation-plan.md:125`, "compare the day summary to the drawer").
 */
export interface DaySummaryResponse {
  date: string;
  takings: TakingsRow[];
  /**
   * The recharge FACE VALUE of completed recharges, which EXCLUDES our own charge.
   *
   * ⚠ Never compare the drawer against this. See `totalCollected`.
   */
  totalTakings: number;
  /** Reported separately and kept separate: 60% of DTH margin (§14.10). */
  totalSurcharge: number;
  /**
   * `totalTakings + totalSurcharge` — what the customer handed over for the recharges
   * COMPLETED today. The day's recognised income.
   *
   * ⚠ NOT the till figure. See `cashCollectedToday`.
   */
  totalCollected: number;
  /**
   * The day's NET movement on `CASH_RECHARGE`, read from the ledger.
   *
   * ⚠ THIS IS WHAT THE TILL RECONCILES AGAINST, and the identity has three terms:
   *
   *     cashCollectedToday  =  tenderMix.CASH  −  cashPaidOutToday
   *
   * It was two until money could leave the till. `ck_txnpay_amount CHECK (AMOUNT > 0)`
   * makes a negative tender line unrepresentable — V12's way of saying the tender rows
   * record what was COLLECTED, never the net of a visit — so a refund moves the ledger
   * figure and leaves the tender figure untouched. Driving one refund through a running
   * backend read 849 against 1199.
   *
   * It replaces two earlier formulas, both of which this screen shipped or nearly did:
   *
   *   1. `totalTakings + heldPending` omitted our own charge, so it was ₹10 short per
   *      DTH recharge.
   *   2. `totalCollected + heldPending` fixed that and was still wrong twice over —
   *      `heldPending` has no date filter, so an overnight unresolved sale corrupts every
   *      later day, and it counts UPI and credit settlements that never touched the till.
   *
   * Both balanced only for same-day, all-cash baskets, which was the shape of every
   * fixture. There is no addition left here to get wrong.
   */
  cashCollectedToday: number;
  /**
   * What went back over the counter today: the credit side of `CASH_RECHARGE`.
   *
   * Zero on most days, and worth SHOWING on the days it is not rather than only
   * subtracting — a staff member counting the drawer needs to know ₹350 left it.
   */
  cashPaidOutToday: number;
  /** Keys are absent when zero, so a missing `UPI` means none was taken. */
  tenderMix: Partial<Record<SettlementMethod, number>>;
  awaitingCount: number;
  unresolvedFailureCount: number;
  /**
   * The `RCHG_PENDING` balance: ALL-TIME and ALL-TENDER open exposure.
   *
   * ⚠ Not a term in the till equation. It keeps money from recharges left unresolved on
   * earlier days, and it includes UPI and credit settlements that never reached the
   * drawer. It EXPLAINS why takings sit below cash collected; it does not balance against
   * the till.
   */
  heldPending: number;
}

export interface TakingsRow {
  operatorCode: string;
  routeCode: string;
  count: number;
  amount: number;
  surcharge: number;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * `request/RechargeLineRequest.java`.
 *
 * ⚠ `surcharge` is tri-state and the difference matters: omit the field to take the
 * configured default, send `0` to clear it. §15.11 item 3 keeps the field editable —
 * "the staff can change or clear it. The owner was explicit" — so an explicit zero on a
 * DTH line must survive, and the client must never send `0` to mean "unset".
 *
 * No `routeCode`: it is server-owned at settlement and overridable at completion
 * (§14.6). At the moment the customer pays nobody yet knows which connection is used.
 */
export interface RechargeLineRequest {
  serviceType: ServiceType;
  number: string;
  operatorCode: string;
  amount: number;
  surcharge?: number;
}

/** `request/SettlementLineRequest.java`. `amountTendered` is meaningful on CASH alone. */
export interface SettlementLineRequest {
  method: SettlementMethod;
  amount: number;
  amountTendered?: number;
  reference?: string;
  customerId?: number;
  note?: string;
}

/**
 * `request/SettleBasketRequest.java`. No total, no change, no status, no route — all
 * four are server-owned, so the client cannot disagree with one.
 */
export interface SettleBasketRequest {
  recharges: RechargeLineRequest[];
  settlementLines: SettlementLineRequest[];
}

/** `request/MarkCompleteRequest.java` — where the route override lands (§14.6). */
export interface MarkCompleteRequest {
  vendorRef?: string;
  routeCode?: string;
}

/** `request/MarkFailedRequest.java`. */
export interface MarkFailedRequest {
  reason?: string;
}

/**
 * `request/RetryRechargeRequest.java` — #12.
 *
 * ⚠ `amount` is the FACE VALUE. The original line's surcharge carries over unchanged, so
 * a DTH retry still carries its ₹10, and the difference is the change in face value — the
 * only number the staff member typed.
 *
 * ⚠ EXACTLY ONE of the two settlement fields is required, and sending the wrong one is a
 * 422 `UNSETTLED_DIFFERENCE`:
 *
 *   - lower than the original → `differenceSettlement` (money going back out)
 *   - higher than the original → `topUp` (money coming back in)
 *   - the same → NEITHER, and sending either is refused
 *
 * Both directions are refused rather than one ignored: silently dropping a cash-back
 * would leave the staff member believing money changed hands while the drawer disagrees
 * (`RechargeFailureResolutionService.java:286-288`).
 */
export interface RetryRechargeRequest {
  amount: number;
  differenceSettlement?: {
    mode: ResidualMode;
    customerId?: number | null;
    note?: string | null;
  };
  /**
   * ⚠ Not in `design-api.md` §3.3, which has no field for money coming IN. Log §7.4
   * says the same mechanism covers the opposite direction, so the server added it
   * deliberately. A top-up appends a tender line to the ORIGINAL payment and raises
   * its total; it never creates a second payment.
   */
  topUp?: {
    method: SettlementMethod;
    customerId?: number | null;
    note?: string | null;
  };
}

/**
 * `request/RefundRechargeRequest.java` — #13.
 *
 * ⚠ `amount` must be the WHOLE line total, SURCHARGE INCLUDED. A partial refund is a
 * 422: `REFUNDED` is terminal, so anything left behind would sit in `RCHG_PENDING`
 * against a recharge that can never be retried, completed or refunded again.
 *
 * ⚠ `customerId` is IGNORED for `CREDIT_REDUCTION` — the money goes to the customer on
 * the original payment's credit line, because letting a request name a different one
 * would move a debt between two people's accounts
 * (`RechargeFailureResolutionService.resolveResidual`). No mode requires it since
 * `KEEP_AS_ADVANCE` was withdrawn.
 *
 * ⚠ `note` is REQUIRED when `mode` is `UPI` and carries the UPI transaction reference —
 * a 422 `UPI_REQUIRES_REFERENCE` otherwise. It is also the first mode to read `note` at
 * all: the server accepted the field and dropped it until 2026-10-21.
 */
export interface RefundRechargeRequest {
  amount: number;
  mode: ResidualMode;
  customerId?: number | null;
  note?: string | null;
}

/** `request/CreateCustomerRequest.java`. `lastName` is deliberately not required. */
export interface CreateCustomerRequest {
  firstName: string;
  lastName?: string;
  mobile: string;
}

/** The filter artboard 7 draws. Every field is optional; the server defaults the year. */
export interface HistoryQuery {
  financialYear?: string;
  /** A prefix match, not a contains (§"History" of next-session-s3-screens.md). */
  number?: string;
  operatorCode?: string;
  routeCode?: string;
  status?: RechargeStatus;
  staffId?: number;
  reference?: string;
  page?: number;
  size?: number;
}
