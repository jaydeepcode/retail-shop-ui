/**
 * The wire shapes of `AccountsController` — endpoints 1-4 of `design-ledger-api.md` §1.1,
 * plus 5 and 6 (§1.2, the UPI settlement tab) below. Endpoints 7-9, 12 and 19 are being
 * built in parallel and have nothing here yet.
 *
 * Mirrors `accounting/model/{request,response}/*.java` field for field.
 */

// ---------------------------------------------------------------------------
// Endpoint 1 — GET /accounts/close-preview
// ---------------------------------------------------------------------------

/**
 * Everything closeable tonight, in one call.
 *
 * ⚠ **No `poolCode` on the path, and that is the whole shape of this screen.** Artboard 9
 * draws one screen with the recharge/ticket drawer in detail, the water drawer as
 * `CANNOT BALANCE YET`, and the safe counted on its own — so a preview per pool would be
 * three round trips for one screen, and the safe has no preview of its own to ask for
 * (`ClosePreviewResponse.java:11-27`). There is no route parameter per pool.
 */
export interface ClosePreviewResponse {
  pools: PoolPreview[];
  accounts: AccountPreview[];
}

export interface PoolPreview {
  poolCode: string;
  /**
   * The sum of the members' **derived** balances, never of their last recorded ones: the
   * sweep leaves every member at zero, so a recorded figure would read `0.00` every
   * evening.
   */
  expectedAmount: number;
  /**
   * `acc_reconciliation.CLOSED_AT` — when the drawer was physically last emptied, which is
   * the left edge of `expectedAmount`. `null` when it never has been.
   */
  lastClosedAt: string | null;
  /**
   * `RECON_DATE` — which business day was last sealed. The two dates agree on an ordinary
   * evening and diverge whenever a close happens after midnight, which is why both are
   * sent. This is the field the day being sealed is computed from.
   */
  lastReconDate: string | null;
  closeable: boolean;
  /**
   * A display reason code, `null` when `closeable`. ⚠ Deliberately not an `ErrorCode` —
   * nothing here is an error. The server states the fact and the screen owns the wording
   * (`ClosePreviewResponse.java:44-52`).
   */
  reason: string | null;
  members: MemberPreview[];
}

export interface MemberPreview {
  accountCode: string;
  displayName: string;
  isPoolPrimary: boolean;
  derivedBalance: number;
}

/** A reconcilable account that closes on its own, through endpoint 4 — the safe, a bank, a float. */
export interface AccountPreview {
  accountCode: string;
  displayName: string;
  derivedBalance: number;
  lastClosedAt: string | null;
  lastReconDate: string | null;
}

/** The one `reason` code the server sends today (`LedgerCloseService.java:154`). */
export const CROCKERY_NOT_RECORDED = 'CROCKERY_NOT_RECORDED';

// ---------------------------------------------------------------------------
// Endpoints 2 and 4 — the writes
// ---------------------------------------------------------------------------

export type VarianceDirection = 'IN' | 'OUT';

/**
 * Where the difference went, when somebody can say.
 *
 * ⚠ It works in **both directions**, and that was a correction rather than an addition
 * (log §14.4). `IN` posts a `RECEIPT` crediting an `INCOME` account with
 * `ALLOW_MANUAL = TRUE`; `OUT` posts a `PAYMENT` debiting an `EXPENSE` account with the
 * same flag. `EXP_CASH_SHORT` and `INC_CASH_OVER` keep catching only the genuinely
 * unexplained — always, and with no threshold — and are reached by omitting this block,
 * never by naming them.
 *
 * `reason` is `RATE_CORRECTION` only, on a float through endpoint 4, and so is never sent
 * from this screen; the field is here because the server refuses a block carrying both.
 */
export interface ExplainedVariance {
  direction: VarianceDirection;
  accountCode?: string;
  reason?: 'RATE_CORRECTION';
  /**
   * Must equal the whole variance exactly, and positive — the direction carries the sign.
   * A partial explanation is refused rather than split, so the remainder can never land in
   * `EXP_CASH_SHORT` unnoticed (`LedgerCloseService.resolveExplanation`).
   */
  amount: number;
}

/**
 * The day close (endpoint 2, A1): one POST, not a count plus a separate sweep.
 *
 * ⚠ **No `Idempotency-Key` header**, and that is a deliberate exception to the convention
 * every other write in this application follows (§1.3). "Close POOL-1 for 9 Nov" is true
 * at most once, so the key is server-derived — `POOL_CLOSE:<poolCode>:<reconDate>` — and
 * `uk_recon_account_date` is the guard. `AccountsController.java:38-50` is explicit that a
 * required header whose value the server ignores is worse than none. So this screen does
 * **not** call `newIdempotencyKey`; the replay protection it would buy is already in the
 * unique key, and a fresh key per click would buy nothing.
 */
export interface PoolCloseRequest {
  /** The business day being sealed, `YYYY-MM-DD`. Required, and never defaulted to today. */
  reconDate: string;
  /** What was physically counted, as one figure for the whole drawer. */
  countedAmount: number;
  note?: string;
  explained?: ExplainedVariance;
}

/** Closing a single reconcilable account that is not in a pool — here, the safe. */
export interface ReconciliationRequest {
  reconDate: string;
  countedAmount: number;
  /** Float accounts only, and the safe is not one, so this screen never sends it. */
  faceCounted?: number;
  note?: string;
  explained?: ExplainedVariance;
}

/** One `acc_reconciliation` row on the wire: endpoint 4's body, and one member of a close. */
export interface ReconciliationResponse {
  reconId: number;
  accountCode: string;
  reconDate: string;
  countedAmount: number;
  /** The derived balance as it stood **before** the variance journal (`design-ledger.md:584`). */
  ledgerAmount: number;
  varianceAmount: number;
  faceCounted: number | null;
  faceLedger: number | null;
  note: string | null;
  varianceVoucherId: number | null;
  closedAt: string;
}

export type SweepStatus = 'POSTED' | 'SKIPPED_ALL_MEMBERS_ZERO';

/**
 * ⚠ A status and not a nullable voucher id. A day where every member took nothing still
 * gets its `acc_reconciliation` rows — they are the evidence the count happened — and gets
 * no sweep voucher, because `ck_line_nonzero CHECK (DR_AMOUNT + CR_AMOUNT > 0)` would
 * refuse a zero leg and fail the whole close (§1.1, "A zero leg is illegal").
 */
export interface Sweep {
  voucherId: number | null;
  amount: number;
  status: SweepStatus;
}

/** What one day close wrote. Also the body of the 409 a replay returns. */
export interface PoolCloseResponse {
  poolCode: string;
  reconDate: string;
  countedAmount: number;
  expectedAmount: number;
  varianceAmount: number;
  varianceVoucherId: number | null;
  sweep: Sweep;
  members: ReconciliationResponse[];
  /** `true` when this close already existed and nothing was written. */
  replayed: boolean;
}

// ---------------------------------------------------------------------------
// Endpoint 5 — GET /accounts/upi-clearing/pending
// ---------------------------------------------------------------------------

/**
 * One collection date still (partly) in transit (`UpiPendingResponse.PendingDate.java`).
 *
 * ⚠ **`pendingAmount` can be negative.** A correcting `JOURNAL` crediting `UPI_CLEARING` is
 * dated the day the mistake was *found* (FRD §8.3), so it can take a date below what has
 * already been settled against it. The server shows a negative row rather than filtering
 * it out — a reconciliation that silently stopped adding up is worse than an odd figure.
 */
export interface UpiPendingDate {
  collectionDate: string;
  /** What customers paid by UPI that day. */
  collectedAmount: number;
  /** What the bank has credited against it so far, across however many settlements (A4). */
  settledAmount: number;
  /** `collectedAmount − settledAmount`, and what endpoint 6 will accept at most for this date. */
  pendingAmount: number;
  /** Days from `collectionDate` to the server's `asOf`. `0` on the day itself. */
  ageDays: number;
}

/** What is still in transit, grouped by collection date and aged (§1.2). */
export interface UpiPendingResponse {
  asOf: string;
  totalPending: number;
  /** Oldest first — `UpiPendingResponse.java`'s own words: "the order the money should arrive in". */
  dates: UpiPendingDate[];
}

// ---------------------------------------------------------------------------
// Endpoint 6 — POST /accounts/upi-clearing/settlements
// ---------------------------------------------------------------------------

/**
 * What the bank actually credited (A4, `UpiSettlementRequest.java`).
 *
 * ⚠ **This write takes a client-generated `Idempotency-Key`, unlike endpoints 2 and 4
 * above.** §1.3's table originally had this key server-derived —
 * `UPI_SETTLEMENT:<collectionDate>:<n>` — and that was corrected on 2026-11-16 specifically
 * because a server-derived key double-posts a settlement on retry: the server would derive
 * `n + 1` for the retry too, recording the bank's credit twice. `newIdempotencyKey` from
 * `shared/` is the rule here.
 */
export interface UpiSettlementRequest {
  /** The day the money was taken from customers. Identifies the settlement. */
  collectionDate: string;
  /** The day it landed in the bank. Never before `collectionDate`. */
  settledOn: string;
  /** What the bank actually credited — not necessarily the whole collected total. */
  settledAmount: number;
  note?: string;
}

/**
 * One recorded settlement — the body of both the `201` and the `409` a replay returns.
 *
 * ⚠ **Unlike a close's replay, this is the SAME shape on both responses** — `replayed` is
 * simply `true` on the second. There is no separate type to narrow to.
 *
 * ⚠ **`bankAccountCode` is read-only confirmation and arrives only here.**
 * `rc_setting['bank.default.account']` resolves server-side (log §9.3) and is deliberately
 * absent from `GET /config` too — "shipping it to a client invites a client to send it
 * back." This screen has no account picker and builds none: the destination is named
 * generically until a settlement actually lands and the server says which account it used.
 */
export interface UpiSettlementResponse {
  collectionDate: string;
  settledOn: string;
  settledAmount: number;
  /** What was collected that day, re-read at the moment of this settlement. */
  collectedAmount: number;
  /** Everything credited against this collection date so far, including this call. */
  settledToDate: number;
  /** What is still in transit for this date after this call. Positive is normal (§1.2). */
  residualAmount: number;
  /** `UPI_SETTLEMENT:<collectionDate>:<n>` — the published identity, not the idempotency key. */
  sequence: string;
  bankAccountCode: string;
  voucherId: number;
  reconciliation: ReconciliationResponse;
  /** `true` when this exact `Idempotency-Key` had already been recorded; the body of the 409. */
  replayed: boolean;
}

// ---------------------------------------------------------------------------
// GET /config
// ---------------------------------------------------------------------------

/**
 * The shared settings endpoint — `rc_setting` read through `SettingService`, beside
 * `/recharge/config` rather than inside it (`next-session-s5.md`, item 3).
 *
 * Only the field this screen reads is declared. The name follows
 * `CounterConfigResponse.java:18`, which is the same setting on the same wire.
 *
 * ⚠ **`change.display.threshold` is read here and never written as a literal.** There are
 * already two hardcoded `5`s in this codebase — `TicketResponseMapper.java` and
 * `tickets/booking/booking.component.ts:94` — and both carry a comment apologising for
 * themselves. A third is not acceptable (§14.5, and `shop-web/CLAUDE.md`).
 */
export interface SharedConfigResponse {
  /** `rc_setting['change.display.threshold']`, in rupees. */
  changeDisplayThreshold: number;
}
