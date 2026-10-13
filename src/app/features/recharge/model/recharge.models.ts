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
  | 'INVALID_TENDER'
  | 'UNSETTLED_DIFFERENCE'
  | 'REFUND_MODE_NOT_AVAILABLE'
  | 'TOO_MANY_CREDIT_LINES'
  | 'NO_COMMISSION_RATE'
  | 'REASON_REQUIRED'
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
 * `response/DaySummaryResponse.java` — what the slice's gate reads
 * (`implementation-plan.md:125`, "compare the day summary to the drawer").
 */
export interface DaySummaryResponse {
  date: string;
  takings: TakingsRow[];
  /** COMPLETED only, which is why the drawer exceeds it whenever something is held. */
  totalTakings: number;
  /** Reported separately and kept separate: 60% of DTH margin (§14.10). */
  totalSurcharge: number;
  /** Keys are absent when zero, so a missing `UPI` means none was taken. */
  tenderMix: Partial<Record<SettlementMethod, number>>;
  awaitingCount: number;
  unresolvedFailureCount: number;
  /** The `RCHG_PENDING` balance, so it reconciles rather than merely displays. */
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
