import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { errorSentence } from '../../recharge/services/recharge-error';
import {
  AccountPreview,
  ClosePreviewResponse,
  CROCKERY_NOT_RECORDED,
  ExplainedVariance,
  MemberPreview,
  PoolCloseResponse,
  PoolPreview,
  ReconciliationResponse,
  VarianceDirection
} from '../model/accounts.models';
import {
  AccountsApiService,
  asReplayedAccountClose,
  asReplayedClose
} from '../services/accounts-api.service';

/** One of artboard 9's four reasons. */
export interface CloseReason {
  id: 'ROUNDING' | 'PAID_FOR_SOMETHING' | 'TAKEN_OUT' | 'NO_IDEA';
  label: string;
  hint: string;
  /** `null` on "No idea": no `explained` block is sent, and the close posts the variance itself. */
  direction: VarianceDirection | null;
  accountCode: string | null;
}

/**
 * The four reasons, in artboard 9's order.
 *
 * ⚠ **The two `IN` reasons were new, and are the reason V34 exists.** §1.1 requires the
 * named account to be an `INCOME` account with `ALLOW_MANUAL = TRUE`, and all five income
 * accounts V21 seeds carry `FALSE` — so `direction: "IN"` had no account it could legally
 * name until `INC_SUNDRY_SHOP` was seeded (V34, cap 33 → 34). Both post to it, and
 * **which one it was is carried in the note**, because the narration the server writes
 * names only the account and both reasons name the same one.
 *
 * ⚠ `INC_CASH_OVER` and `EXP_CASH_SHORT` are absent on purpose. They are reached by
 * sending no `explained` block at all — "No idea" — and naming them by hand is refused
 * (A7). They catch only the genuinely unexplained, always and with no threshold.
 */
export const CLOSE_REASONS: CloseReason[] = [
  {
    id: 'ROUNDING',
    label: 'Small change rounding',
    hint: '',
    direction: 'IN',
    accountCode: 'INC_SUNDRY_SHOP'
  },
  {
    id: 'PAID_FOR_SOMETHING',
    label: 'Someone paid for something',
    hint: 'photocopy, form filling, other',
    direction: 'IN',
    accountCode: 'INC_SUNDRY_SHOP'
  },
  {
    // §1.1's own worked example is this case, and it names the account:
    // `"note": "₹50 short — milk for the shop"` with `EXP_SUNDRY_SHOP`. The artboard draws
    // no account picker here and endpoint 12 — the picker — is not built, so the code is
    // fixed rather than chosen. Any of the five ALLOW_MANUAL expense accounts would be
    // legal; this is the one the design document picks for tea, milk and stationery.
    id: 'TAKEN_OUT',
    label: 'Money was taken out',
    hint: 'tea, milk, stationery',
    direction: 'OUT',
    accountCode: 'EXP_SUNDRY_SHOP'
  },
  { id: 'NO_IDEA', label: 'No idea', hint: '', direction: null, accountCode: null }
];

/**
 * The account the sweep lands in, and the one single account this screen closes.
 *
 * ⚠ Named here because nothing on the wire marks which single account the sweep goes to:
 * `AccountPreview` carries no flag for it and `V21:331` files `CASH_SAFE` under cash pool
 * `SAFE`, which the server deliberately does not treat as a pool (ADR 0002). So the code is
 * the only handle there is.
 */
export const CASH_SAFE = 'CASH_SAFE';

/** The till whose pool is the drawer this screen counts in detail — see `pool`. */
export const CASH_RECHARGE = 'CASH_RECHARGE';

/** What a numbered step of "What closing does" says. */
export interface CloseStep {
  title: string;
  detail: string;
}

/**
 * `/accounts/close` — artboard 9, whole.
 *
 * The recharge day summary above is S3's gate and is unchanged. Everything below it is
 * this slice's: the count, the difference, the four reasons, the sweep, and closing the
 * day. The `<app-section-placeholder>` that stood in its place is gone rather than kept
 * beside it — a screen shows one or the other, never both (`shop-web/CLAUDE.md`).
 *
 * ## One screen, three closeable things, and no route parameter
 *
 * `GET /accounts/close-preview` takes no parameters and answers for the whole screen: every
 * pool with its members, every single reconcilable account. So the drawer shown in detail
 * is **derived** — the closeable pool the recharge till belongs to, see {@link pool} — and
 * everything else goes under "Also to close tonight": a pool that cannot balance yet with
 * the server's reason, and the safe, which closes through endpoint 4 because it is not a
 * pool (ADR 0002). The banks, UPI clearing and the four floats come back on the same call
 * and are named but not offered here — see {@link countableAccounts}.
 *
 * ## The day being sealed is never "today"
 *
 * ⚠ `reconDate` defaults to the **oldest unclosed day**, which is `lastReconDate + 1`. A
 * close dated today at 00:30 writes `RECON_DATE = <today>` while the lock test is
 * `RECON_DATE >= VOUCHER_DATE`, so it seals every one of yesterday's vouchers while
 * yesterday itself never receives a count — sealed, uncounted and unamendable, with no row
 * anywhere recording what was in the drawer (§1.1). Skipping a day does not leave it open;
 * it seals it blind.
 *
 * The *Change day* control offers only days that are unclosed and not in the future. A free
 * date picker would be worse than no control at all, because it invites sealing the wrong
 * day.
 *
 * ## The screen suggests, it does not decide
 *
 * "Small change rounding" is offered as **likely** when the difference is small and
 * positive, and is not selected. A preselected reason is a reason nobody chose. The
 * threshold that makes it likely is read from `GET /config`
 * (`rc_setting['change.display.threshold']`) and is never a literal — when that read fails,
 * the screen offers no suggestion at all rather than inventing a figure.
 *
 * ## Two words from the artboard are deliberately not copied
 *
 * The artboard's button reads *"Close the drawer for today"* and its footer *"Once closed,
 * today's entries…"*. Both contradict the `CLOSING` line directly above them, and when the
 * day being sealed is Tuesday and the clock says Wednesday — the exact case that line exists
 * for — both are wrong. So the button names the day it is sealing and the footer says "that
 * day's entries" (`design-ledger-api.md` §1.1, noticed 2026-11-12).
 *
 * ## No `Idempotency-Key`, and no payment panel
 *
 * Endpoints 2 and 4 take no `Idempotency-Key` header: the key is server-derived and
 * `uk_recon_account_date` is the guard, so `newIdempotencyKey` is not called here. And the
 * shared payment panel is not reused — a close is not a sale and has no tender.
 */
@Component({
  selector: 'app-close',
  templateUrl: './close.component.html',
  styleUrl: './close.component.scss'
})
export class CloseComponent implements OnInit, OnDestroy {
  readonly reasons = CLOSE_REASONS;
  readonly crockeryNotRecorded = CROCKERY_NOT_RECORDED;

  preview: ClosePreviewResponse | null = null;
  loading = true;
  loadError = '';

  /**
   * `rc_setting['change.display.threshold']`, in rupees, or `null` when `GET /config` could
   * not be read.
   *
   * ⚠ **There is no fallback, and that is the point.** Two literal `5`s already exist in
   * this codebase and both carry a comment apologising for themselves; a third is not
   * acceptable. Without the setting the screen cannot say what "small" means, so it does
   * not suggest — the reason stays offered and unmarked, and nothing else on the screen
   * changes. A guessed threshold would quietly become the rule it was standing in for.
   */
  threshold: number | null = null;

  /** `YYYY-MM-DD` — the business day being sealed. */
  reconDate = '';
  changingDay = false;

  /** What the operator typed, in rupees. Text rather than a number so "3,395" reads back. */
  countedInput = '';
  note = '';
  reasonId: CloseReason['id'] | null = null;

  closing = false;
  closeError = '';
  closed: PoolCloseResponse | null = null;

  /** The safe, counted on its own after the sweep. */
  safeOpen = false;
  safeCountedInput = '';
  safeNote = '';
  safeClosing = false;
  safeError = '';
  safeClosed: ReconciliationResponse | null = null;

  private readonly subscriptions = new Subscription();

  constructor(private api: AccountsApiService) {}

  ngOnInit(): void {
    this.loadConfig();
    this.load();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.subscriptions.add(
      this.api.closePreview().subscribe({
        next: (preview) => {
          this.loading = false;
          this.preview = preview;
          // ⚠ Re-derived on every read, including the reload after a close: once a day is
          // sealed the oldest unclosed day moves on, and a stale `reconDate` would offer
          // to close the same day twice and collect a 409 for it.
          this.reconDate = this.oldestUnclosedDay();
          this.changingDay = false;
        },
        error: (error) => {
          this.loading = false;
          this.loadError = errorSentence(error);
        }
      })
    );
  }

  /**
   * The threshold, and nothing else from `/config`.
   *
   * A failure is not reported to the operator: nothing on this screen depends on it except
   * whether one reason carries the word "likely", and an error strip about a settings read
   * on the evening close would be noise about something nobody can act on.
   */
  private loadConfig(): void {
    this.subscriptions.add(
      this.api.config().subscribe({
        next: (config) => {
          const value = config?.changeDisplayThreshold;
          this.threshold = typeof value === 'number' && value > 0 ? value : null;
        },
        error: () => (this.threshold = null)
      })
    );
  }

  // -- Which drawer is in detail, and what is merely listed ------------------

  /**
   * The drawer counted in detail: the closeable pool the recharge till belongs to.
   *
   * Derived rather than routed. The preview answers for the whole screen, so a route
   * parameter per pool would be a second way to say what the data already says — and on
   * the evening it mattered it would be a URL naming a drawer that cannot balance.
   *
   * ⚠ **The tie-break on `CASH_RECHARGE` is not decoration, and the running server is how
   * that was found.** The preview orders pools by `SORT_ORDER`, and `CASH_WATER` is 100
   * against `CASH_RECHARGE`'s 110 (`V21:283-284`) — so "the first closeable pool" answers
   * `POOL-2` the moment the water drawer becomes closeable, and this screen would count
   * the water drawer in detail underneath a panel reporting the recharge day. It reads
   * `POOL-1` today only because crockery is unrecorded.
   *
   * The right half of the pair is the drawer the counter above it is about, which is the
   * one holding `CASH_RECHARGE`. ⚠ When crockery lands, the water drawer becomes closeable
   * and needs a detail half of its own; that is a screen, not a tie-break, and artboard 9
   * does not draw it.
   */
  get pool(): PoolPreview | null {
    const closeable = (this.preview?.pools ?? []).filter((p) => p.closeable);
    return (
      closeable.find((p) => p.members.some((m) => m.accountCode === CASH_RECHARGE))
      ?? closeable[0]
      ?? null
    );
  }

  /** Every other pool — the water drawer, which cannot balance until crockery is recorded. */
  get otherPools(): PoolPreview[] {
    const detail = this.pool;
    return (this.preview?.pools ?? []).filter((p) => p !== detail);
  }

  /** Every account the server says closes on its own — the safe, four banks, four floats. */
  get singleAccounts(): AccountPreview[] {
    return this.preview?.accounts ?? [];
  }

  /**
   * The accounts this screen offers to close: the safe, and nothing else.
   *
   * ⚠ **The running server answers with ten single accounts, not one**, and that is what
   * sent this through a filter. Artboard 9's "Also to close tonight" draws the water drawer
   * and the safe; the preview also returns `BANK_JANATA`, `BANK_SELF`, `BANK_WIFE`,
   * `BANK_FATHER`, `UPI_CLEARING` and the four operator floats, because endpoint 1 answers
   * for everything closeable and other screens consume the same call.
   *
   * Offering them here would be worse than leaving them out. A float's close is **the only
   * place its balance may be corrected** (§1.1, log §14.9), and doing that needs the portal's
   * face figure and the `RATE_CORRECTION` reason — which is artboard 12, the float top-up,
   * and is not this screen. A float counted through a plain count box would post a variance
   * to `EXP_CASH_SHORT` and quietly skip the correction that was the point.
   *
   * So they are named rather than dropped: {@link elsewhereSentence} says they exist and
   * where they close. A screen that silently omitted them would read as complete.
   */
  get countableAccounts(): AccountPreview[] {
    return this.singleAccounts.filter((a) => a.accountCode === CASH_SAFE);
  }

  /** The single accounts this screen does not close, named so their absence is visible. */
  get elsewhereAccounts(): AccountPreview[] {
    return this.singleAccounts.filter((a) => a.accountCode !== CASH_SAFE);
  }

  get elsewhereSentence(): string {
    const others = this.elsewhereAccounts;
    if (!others.length) {
      return '';
    }
    const floats = others.filter((a) => a.accountCode.startsWith('FLOAT_')).length;
    const rest = others.length - floats;
    const parts: string[] = [];
    if (rest) {
      parts.push(`${countWord(rest)} bank and clearing accounts`);
    }
    if (floats) {
      parts.push(`${countWord(floats)} operator floats`);
    }
    return `${parts.join(' and ')} also close on their own, and not from here — a float's`
      + ' count is the only place its balance may be corrected, which needs the portal'
      + ' figure. Those screens are the UPI and Move money tabs, still to be built.';
  }

  get members(): MemberPreview[] {
    return this.pool?.members ?? [];
  }

  /** "two", for the sentences that name how many businesses share the drawer. */
  get memberCountWord(): string {
    return countWord(this.members.length);
  }

  /**
   * The safe, for the "After closing" projection.
   *
   * ⚠ Found by `isPoolPrimary`-free identity rather than by name where possible: the
   * preview files the safe under single accounts precisely because it is not a pool. The
   * code is still needed, because nothing on the wire marks which single account the sweep
   * lands in.
   */
  get safe(): AccountPreview | null {
    return this.singleAccounts.find((a) => a.accountCode === CASH_SAFE) ?? null;
  }

  // -- The figures ----------------------------------------------------------

  /**
   * What the books say, as one figure for the drawer.
   *
   * Read, never summed from the members: `expectedAmount` is the sum of **derived**
   * balances and the server is the only thing that derives them.
   */
  get expected(): number {
    return this.pool?.expectedAmount ?? 0;
  }

  /** What was counted, or `null` while the box is empty or unreadable. */
  get counted(): number | null {
    return parseRupees(this.countedInput);
  }

  get countedIsUnreadable(): boolean {
    return this.countedInput.trim() !== '' && this.counted === null;
  }

  /**
   * Counted − books, or `null` until a figure is typed.
   *
   * ⚠ Compared and subtracted in **paise as integers**. Two JSON floats that should be
   * equal sometimes are not, and this is the figure that decides whether a reason is
   * offered at all and what amount is sent with it — a difference of 0.009999 would offer
   * to explain a drawer that balances, and the server would refuse the block.
   */
  get differencePaise(): number | null {
    const counted = this.counted;
    return counted === null ? null : paise(counted) - paise(this.expected);
  }

  get difference(): number | null {
    const diff = this.differencePaise;
    return diff === null ? null : diff / 100;
  }

  get hasDifference(): boolean {
    return (this.differencePaise ?? 0) !== 0;
  }

  get isOver(): boolean {
    return (this.differencePaise ?? 0) > 0;
  }

  /** The amount an `explained` block would carry: the whole variance, positive. */
  get differenceAbs(): number {
    return Math.abs(this.differencePaise ?? 0) / 100;
  }

  /** The direction the variance's sign demands. The server refuses the other one. */
  get direction(): VarianceDirection | null {
    if (!this.hasDifference) {
      return null;
    }
    return this.isOver ? 'IN' : 'OUT';
  }

  // -- The reasons ----------------------------------------------------------

  /**
   * Whether this reason can be sent for the difference as it stands.
   *
   * ⚠ The server refuses a direction that disagrees with the sign — `OUT` on an over, `IN`
   * on a short — so an unavailable reason is shown disabled rather than left clickable to
   * collect a 422. "Money was taken out" cannot explain a drawer with too much in it.
   */
  isAvailable(reason: CloseReason): boolean {
    if (!this.hasDifference) {
      return false;
    }
    return reason.direction === null || reason.direction === this.direction;
  }

  /** Why a reason is disabled, in the operator's terms. */
  unavailableBecause(reason: CloseReason): string {
    if (!this.hasDifference || reason.direction === null) {
      return '';
    }
    return reason.direction === 'IN'
      ? 'only when the drawer is over'
      : 'only when the drawer is short';
  }

  /**
   * Whether this reason is the likely one — offered, **never** selected.
   *
   * §1.1: "Where the variance is small and positive, the close offers 'small change
   * rounding' as a likely reason rather than preselecting it — the operator confirms."
   * Small and positive is read from the threshold and nowhere else, so no suggestion is
   * made when `/config` did not answer.
   */
  isSuggested(reason: CloseReason): boolean {
    if (reason.id !== 'ROUNDING' || this.threshold === null || this.reasonId !== null) {
      return false;
    }
    const diff = this.differencePaise;
    return diff !== null && diff > 0 && diff < paise(this.threshold);
  }

  get suggestionCaption(): string {
    return `likely — the difference is under ${rupees(this.threshold ?? 0)}`;
  }

  isSelected(reason: CloseReason): boolean {
    return this.reasonId === reason.id;
  }

  /** Clicking the selected reason again un-chooses it, so a mis-click is recoverable. */
  choose(reason: CloseReason): void {
    if (!this.isAvailable(reason)) {
      return;
    }
    this.reasonId = this.reasonId === reason.id ? null : reason.id;
    this.closeError = '';
  }

  get chosen(): CloseReason | null {
    return this.reasons.find((r) => r.id === this.reasonId) ?? null;
  }

  /**
   * ⚠ A reason that no longer fits the figure is dropped as the figure changes.
   *
   * Count 3,395 against 3,392, choose "Small change rounding", then correct the count to
   * 3,390: the reason is now `IN` on a short, which the server refuses with a 422 naming a
   * direction the operator never saw. Clearing it is the only behaviour that cannot be
   * wrong — the reason is offered again the moment the figure justifies it.
   */
  onCountChanged(): void {
    this.closeError = '';
    this.closed = null;
    const chosen = this.chosen;
    if (chosen && !this.isAvailable(chosen)) {
      this.reasonId = null;
    }
  }

  // -- The day being sealed -------------------------------------------------

  /**
   * The oldest day that has not been closed: the day after the last one sealed.
   *
   * ⚠ When the pool has **never** been closed there is nothing to compute from — the
   * preview sends `lastReconDate: null` and no endpoint in this slice says when the
   * drawer's first voucher was. It falls back to today, which is the one case where this
   * screen's default is the thing §1.1 warns about; the `CLOSING` line names the day in
   * full and says so, and *Change day* offers the preceding week.
   */
  private oldestUnclosedDay(): string {
    const last = this.pool?.lastReconDate;
    if (!last) {
      return todayIso();
    }
    const next = addDays(last, 1);
    // ⚠ EMPTY, NOT TODAY, once today itself is sealed — and that was a defect found by
    // closing today and watching the screen. Clamping to today left the CLOSING line
    // naming a day that was already closed, with a live button beside it that could only
    // ever collect a 409. The operator would read "nothing happened" from a screen whose
    // own answer was "already closed", forever. See `nothingLeftToClose`.
    return next > todayIso() ? '' : next;
  }

  /**
   * Whether every day up to today has been sealed.
   *
   * The next day cannot be closed before it exists, so the honest answer is that there is
   * nothing to count — not an eleventh offer to close the day just closed.
   */
  get nothingLeftToClose(): boolean {
    const last = this.pool?.lastReconDate;
    return !!last && last >= todayIso();
  }

  /**
   * The days that may be sealed: unclosed, and not in the future.
   *
   * Capped at 31 so a drawer left unclosed for a season renders a list rather than a year,
   * and oldest first because the oldest is the one to close next.
   */
  get dayOptions(): string[] {
    const today = todayIso();
    const last = this.pool?.lastReconDate;
    const first = last ? addDays(last, 1) : addDays(today, -6);
    const days: string[] = [];
    for (let day = first; day <= today && days.length < 31; day = addDays(day, 1)) {
      days.push(day);
    }
    // ⚠ Empty when everything is sealed, rather than falling back to today — today is the
    // day that was just closed, and offering it is what `nothingLeftToClose` exists to stop.
    return days;
  }

  get neverClosed(): boolean {
    return !!this.pool && this.pool.lastReconDate === null;
  }

  /** `Tuesday 7 Oct`. */
  dayWords(iso: string): string {
    const date = fromIso(iso);
    if (!date) {
      return iso;
    }
    return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  }

  chooseDay(iso: string): void {
    this.reconDate = iso;
    this.changingDay = false;
    this.closed = null;
    this.closeError = '';
  }

  // -- Labels, derived from the server's own names --------------------------

  /** `Cash-Recharge` → `Recharge`. The artboard's own labels, with nothing hardcoded. */
  tillLabel(displayName: string): string {
    return displayName.replace(/^Cash[-\s]/i, '');
  }

  /**
   * `Recharge and ticket drawer`, `Water drawer` — both built from the members' names.
   *
   * A map keyed on `POOL-1` would be two labels to maintain and would render a bare code
   * for a pool it had never heard of.
   */
  poolTitle(pool: PoolPreview): string {
    const labels = pool.members.map((m) => this.tillLabel(m.displayName));
    if (!labels.length) {
      return `${pool.poolCode} drawer`;
    }
    const [first, ...rest] = labels;
    const tail = rest.map((label) => label.toLowerCase());
    const joined = tail.length
      ? [first, ...tail.slice(0, -1)].join(', ') + ' and ' + tail[tail.length - 1]
      : first;
    return `${joined} drawer`;
  }

  /** `one drawer, two businesses — last closed yesterday 20:40`. */
  poolSubtitle(pool: PoolPreview): string {
    const parts: string[] = [];
    if (pool.members.length > 1) {
      parts.push(`one drawer, ${countWord(pool.members.length)} businesses`);
    }
    parts.push(this.lastClosedPhrase(pool.lastClosedAt));
    return parts.join(' — ');
  }

  lastClosedPhrase(lastClosedAt: string | null): string {
    if (!lastClosedAt) {
      return 'never closed before';
    }
    const when = new Date(lastClosedAt);
    if (Number.isNaN(when.getTime())) {
      return 'never closed before';
    }
    const time = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const day = isoOf(when);
    const today = todayIso();
    if (day === today) {
      return `last closed today ${time}`;
    }
    if (day === addDays(today, -1)) {
      return `last closed yesterday ${time}`;
    }
    return `last closed ${this.dayWords(day)} ${time}`;
  }

  /** The screen owns the wording for a `reason` code; the server states only the fact. */
  cannotBalanceBecause(pool: PoolPreview): string {
    if (pool.reason === CROCKERY_NOT_RECORDED) {
      return 'Crockery cash shares this drawer but crockery sales are not recorded anywhere,'
        + ' so the count would always read high.';
    }
    return pool.reason
      ? `This drawer cannot be balanced yet (${pool.reason}).`
      : 'This drawer cannot be balanced yet.';
  }

  // -- What closing does ----------------------------------------------------

  /**
   * The numbered steps, which say what this close will actually write.
   *
   * ⚠ Step 2 is absent when the count matches, and that is not cosmetic: the server refuses
   * an `explained` block on a pool whose count matches exactly, so a screen that promised a
   * variance posting there would be describing a 422.
   */
  get steps(): CloseStep[] {
    const steps: CloseStep[] = [
      {
        title: 'Writes down tonight’s count',
        detail: this.members.length > 1
          ? `One record for each of the ${countWord(this.members.length)} businesses sharing`
            + ' the drawer, so both are sealed against later edits — not one for the drawer,'
            + ' which would leave the other editable.'
          : 'One record for the drawer, sealed against later edits.'
      }
    ];

    if (this.hasDifference) {
      const amount = rupees(this.differenceAbs);
      const chosen = this.chosen;
      if (chosen && chosen.direction !== null) {
        steps.push({
          title: `Records the ${amount} as ${chosen.label.toLowerCase()}`,
          detail: 'Because you named it. Had you left it blank it would go down as'
            + ' unexplained — still recorded, however small, with no threshold below which'
            + ' it is ignored.'
        });
      } else {
        steps.push({
          title: `Records the ${amount} as unexplained`,
          detail: `Nobody could say where it went, so it posts as cash`
            + ` ${this.isOver ? 'over' : 'short'} — recorded however small, with no`
            + ' threshold below which it is ignored.'
        });
      }
    }

    steps.push({
      title: this.sweepWillPost
        ? 'Moves the money to the safe'
        : 'Moves nothing to the safe',
      detail: this.sweepWillPost
        ? `${this.members.length > 1 ? 'Both tills go' : 'The till goes'} to zero, which is`
          + ' where they start tomorrow.'
        : 'Every till already records nothing, so there is nothing to sweep and no voucher'
          + ' is posted. The count is still recorded.'
    });

    return steps;
  }

  /** Whether the sweep has anything to move: no member with a balance, no voucher. */
  get sweepWillPost(): boolean {
    return this.members.some((m) => paise(m.derivedBalance) !== 0);
  }

  /**
   * What the safe holds once this close has run.
   *
   * ⚠ **It is the safe plus the counted figure, in every case**, which is worth stating
   * because it looks like it should depend on the variance. An explained variance hits
   * `CASH_SAFE` and leaves the till's recorded balance alone, so the safe takes the
   * explained amount and then the expected figure; an unexplained one moves the till
   * itself, so the sweep — which re-reads the balances after the variance voucher — carries
   * the counted figure instead. Both come to the same number, and that number is the one
   * the operator can check against the cash they are about to put in the safe.
   */
  get safeAfterClosing(): number | null {
    const safe = this.safe;
    if (!safe) {
      return null;
    }
    const counted = this.counted;
    return counted === null
      ? safe.derivedBalance
      : (paise(safe.derivedBalance) + paise(counted)) / 100;
  }

  // -- Closing the day ------------------------------------------------------

  get canClose(): boolean {
    return (
      !!this.pool
      && !this.closing
      && !this.closed
      && this.counted !== null
      && this.counted >= 0
      && !!this.reconDate
    );
  }

  get closeButtonLabel(): string {
    // ⚠ Names the day it is sealing. The artboard says "for today" and is wrong whenever
    // the clock has passed midnight, which is the case the CLOSING line exists for.
    return this.reconDate
      ? `Close the drawer for ${this.dayWords(this.reconDate)}`
      : 'Close the drawer';
  }

  /**
   * The note as it is sent.
   *
   * ⚠ The reason rides in the note, and it has to. The server's narration names the
   * **account** — "Cash over 3.00 on 2026-10-07: INC_SUNDRY_SHOP" — and both `IN` reasons
   * post to the same account, so without this the record cannot say whether ₹3 was rounding
   * or a photocopy. V34's own note asks for exactly that: "Both reasons post to it, with
   * which one it was carried in the narration."
   */
  noteToSend(): string | undefined {
    const typed = this.note.trim();
    const chosen = this.chosen;
    const prefix = chosen && chosen.direction !== null ? chosen.label : '';
    const full = prefix && typed ? `${prefix}: ${typed}` : prefix || typed;
    // `@Size(max = 255)`, and a 400 for a long note would be the screen's fault.
    return full ? full.slice(0, 255) : undefined;
  }

  private explainedToSend(): ExplainedVariance | undefined {
    const chosen = this.chosen;
    if (!chosen || chosen.direction === null || !this.hasDifference) {
      return undefined;
    }
    return {
      direction: chosen.direction,
      accountCode: chosen.accountCode ?? undefined,
      amount: this.differenceAbs
    };
  }

  close(): void {
    const pool = this.pool;
    const counted = this.counted;
    if (!pool || counted === null || !this.canClose) {
      return;
    }

    this.closing = true;
    this.closeError = '';
    this.subscriptions.add(
      this.api
        .closePool(pool.poolCode, {
          reconDate: this.reconDate,
          countedAmount: counted,
          note: this.noteToSend(),
          explained: this.explainedToSend()
        })
        .subscribe({
          next: (response) => {
            this.closing = false;
            this.closed = response;
            this.clearTheForm();
            // ⚠ Re-read, because the safe is counted AFTER the sweep. Its preview figure is
            // now short by everything that just moved into it, and the operator's next act
            // on this screen is to count it.
            this.load();
          },
          error: (error) => {
            this.closing = false;
            const replayed = asReplayedClose(error);
            if (replayed) {
              // Not an error. The server answered 409 carrying the close that already
              // exists, so the operator gets the figures rather than a refusal.
              this.closed = replayed;
              this.clearTheForm();
              this.load();
              return;
            }
            this.closeError = errorSentence(error);
          }
        })
    );
  }

  /**
   * Empties the count, the note and the reason once a close has landed.
   *
   * ⚠ **This was a defect, and only running a real close found it.** The close reloads the
   * preview, so the drawer's expected figure drops to `0.00` and the day moves on to the
   * next unclosed one — while the box still held `3,395`, the reason was still lit and the
   * panel beside it read *"Records the ₹3,395 as small change rounding"* against a drawer
   * the books now say is empty. The screen was describing a second close of a figure
   * nobody had counted, one button press away, on the day after the one just sealed.
   *
   * Every test passed throughout: they assert what is sent, and this is about what is left
   * behind afterwards.
   */
  private clearTheForm(): void {
    this.countedInput = '';
    this.note = '';
    this.reasonId = null;
    this.closeError = '';
  }

  get closedWasReplay(): boolean {
    return !!this.closed?.replayed;
  }

  get closedVariance(): number {
    return this.closed?.varianceAmount ?? 0;
  }

  get closedSweptNothing(): boolean {
    return this.closed?.sweep.status === 'SKIPPED_ALL_MEMBERS_ZERO';
  }

  // -- The safe, counted on its own ----------------------------------------

  get safeCounted(): number | null {
    return parseRupees(this.safeCountedInput);
  }

  get safeDifference(): number | null {
    const counted = this.safeCounted;
    const safe = this.safe;
    if (counted === null || !safe) {
      return null;
    }
    return (paise(counted) - paise(safe.derivedBalance)) / 100;
  }

  /** The safe has its own day: it is closed by `lastReconDate` of its own row, not the pool's. */
  get safeReconDate(): string {
    const last = this.safe?.lastReconDate;
    if (!last) {
      return todayIso();
    }
    const next = addDays(last, 1);
    return next > todayIso() ? todayIso() : next;
  }

  openSafeCount(): void {
    this.safeOpen = true;
    this.safeError = '';
  }

  /**
   * ⚠ No reason buttons here, which follows the artboard: the safe row offers "Count it"
   * and nothing else. A variance on the safe is the unexplained kind — it posts to
   * `EXP_CASH_SHORT` or `INC_CASH_OVER`, always and with no threshold — and the four reasons
   * are about a counter drawer somebody was standing at.
   */
  closeSafe(): void {
    const safe = this.safe;
    const counted = this.safeCounted;
    if (!safe || counted === null || counted < 0 || this.safeClosing) {
      return;
    }

    this.safeClosing = true;
    this.safeError = '';
    const typed = this.safeNote.trim();
    this.subscriptions.add(
      this.api
        .closeAccount(safe.accountCode, {
          reconDate: this.safeReconDate,
          countedAmount: counted,
          note: typed || undefined
        })
        .subscribe({
          next: (response) => {
            this.safeClosing = false;
            this.safeClosed = response;
            this.load();
          },
          error: (error) => {
            this.safeClosing = false;
            const replayed = asReplayedAccountClose(error);
            if (replayed) {
              this.safeClosed = replayed;
              this.load();
              return;
            }
            this.safeError = errorSentence(error);
          }
        })
    );
  }

  trackByMember(_index: number, member: MemberPreview): string {
    return member.accountCode;
  }

  trackByReason(_index: number, reason: CloseReason): string {
    return reason.id;
  }

  trackByDay(_index: number, iso: string): string {
    return iso;
  }
}

/**
 * Rupees as integer paise.
 *
 * Every comparison and subtraction on this screen goes through it, for the reason
 * `day-summary.component.ts` gives: two JSON floats that should be equal sometimes are not.
 */
function paise(rupeeValue: number): number {
  return Math.round(rupeeValue * 100);
}

/**
 * What the operator typed, or `null` when it is not a figure.
 *
 * `₹` and thousands separators are accepted because the artboard shows the box holding
 * `3,395`. A negative is rejected here rather than sent: the server refuses it, and "a till
 * cannot hold less than nothing" is not a sentence the operator should have to wait for.
 */
export function parseRupees(input: string): number | null {
  const cleaned = (input ?? '').replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * `₹5`, `₹3.50`, `₹3,395` — whole rupees without the decimals nobody reads.
 *
 * ⚠ Grouped, because these figures sit in prose beside the same amounts rendered by
 * `| number: '1.2-2'`, and a step that read "₹3395" next to a count of "3,395" looked like
 * a different number. Found by reading the running screen.
 *
 * ⚠ Grouped as `en-US` to match that pipe, which is what the app renders with: no
 * `LOCALE_ID` is provided anywhere in `src/`, so Angular's default stands. `en-IN` would
 * group a lakh as `1,00,000` beside the pipe's `1,00,000.00`-or-`100,000.00` and put two
 * conventions on one screen. The locale belongs in one place, and this is not it.
 */
function rupees(value: number): string {
  const absolute = Math.abs(value);
  const body = Number.isInteger(absolute)
    ? absolute.toLocaleString('en-US')
    : absolute.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? '−' : ''}₹${body}`;
}

function countWord(count: number): string {
  return ['no', 'one', 'two', 'three', 'four', 'five'][count] ?? String(count);
}

function isoOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function todayIso(): string {
  return isoOf(new Date());
}

/**
 * An ISO day as a **local** date.
 *
 * `new Date('2026-10-07')` is parsed as UTC and reads back as the 6th west of Greenwich.
 * The day being sealed is a business day, so it is built from its parts.
 */
function fromIso(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!match) {
    return null;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(iso: string, days: number): string {
  const date = fromIso(iso);
  if (!date) {
    return iso;
  }
  date.setDate(date.getDate() + days);
  return isoOf(date);
}
