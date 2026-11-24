import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { errorSentence } from '../../recharge/services/recharge-error';
import { newIdempotencyKey } from '../../shared/idempotency-key';
import { UpiPendingDate, UpiPendingResponse, UpiSettlementResponse } from '../model/accounts.models';
import { AccountsApiService, asReplayedUpiSettlement } from '../services/accounts-api.service';

/**
 * `/accounts/upi` — artboard 10, whole: endpoints 5 and 6 of `design-ledger-api.md` §1.2.
 *
 * ## Settle what arrived, not what was expected
 *
 * The amount typed is what the bank statement shows, never re-derived from the collected
 * total. Anything left over stays on the left and ages — **nothing is written off
 * automatically and no write-off account exists** (A4, §1.2): a settlement has never once
 * landed for a different amount than was collected in seven years (log §9.2), so this
 * screen's partial path exists to be correct rather than to be common.
 *
 * ## An `Idempotency-Key`, and this is the tab that needs one
 *
 * ⚠ The close screen's two writes take **no** `Idempotency-Key` — the key is
 * server-derived there, because "close POOL-1 for 9 Nov" is true at most once. Endpoint 6
 * is the opposite case: A4 allows several settlements against one collection date on
 * purpose, so the server cannot tell a double-click from a second real credit for the same
 * date. §1.3's table originally had this key server-derived too
 * (`UPI_SETTLEMENT:<collectionDate>:<n>`) and that was corrected on 2026-11-16 specifically
 * because the server deriving `n + 1` on a retry records the bank's credit twice. So this
 * screen mints an opaque key with `newIdempotencyKey`, **keeps it across a plain failure**
 * (a genuine retry has to look identical, or the key buys nothing), and mints a fresh one
 * only once an attempt has actually landed — a `201` or the `409` a replay returns —
 * because the next click is a new action, never a retry of the one that just succeeded.
 *
 * ## No account picker, because there isn't one
 *
 * `bankAccountCode` arrives only on the response. `rc_setting['bank.default.account']`
 * resolves server-side (log §9.3) and is deliberately absent from `GET /config` too — "a
 * client that could send it could send the wrong one." So the "Where it goes" panel names
 * the destination generically until a settlement actually lands and the server says which
 * account it used.
 *
 * ## The default row is the oldest, never the newest
 *
 * `UpiPendingResponse` itself orders its rows oldest first, "the order the money should
 * arrive in", and that is also this screen's default selection — the same rule the close
 * screen's `oldestUnclosedDay` follows. Settling newest-first would let an old residue age
 * indefinitely behind a stream of fresh dates that always get attention first.
 */
@Component({
  selector: 'app-upi',
  templateUrl: './upi.component.html',
  styleUrl: './upi.component.scss'
})
export class UpiComponent implements OnInit, OnDestroy {
  pending: UpiPendingResponse | null = null;
  loading = true;
  loadError = '';

  selectedDate: string | null = null;

  /** What the operator typed, in rupees. Text rather than a number so "1,450" reads back. */
  amountInput = '';
  /** `YYYY-MM-DD`. Defaults to today on every selection, per `prefillFor`. */
  settledOnInput = todayIso();

  recording = false;
  recordError = '';
  recorded: UpiSettlementResponse | null = null;

  private idempotencyKey = newIdempotencyKey();
  private readonly subscriptions = new Subscription();

  constructor(private api: AccountsApiService) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.subscriptions.add(
      this.api.upiPending().subscribe({
        next: (pending) => {
          this.loading = false;
          this.pending = pending;
          this.selectDefault();
        },
        error: (error) => {
          this.loading = false;
          this.loadError = errorSentence(error);
        }
      })
    );
  }

  get rows(): UpiPendingDate[] {
    return this.pending?.dates ?? [];
  }

  get selected(): UpiPendingDate | null {
    return this.rows.find((r) => r.collectionDate === this.selectedDate) ?? null;
  }

  /**
   * Keeps the current selection if it still exists on a reload — a settlement that only
   * partly cleared a date stays selected, re-prefilled against the fresh residue, so the
   * operator sees the new figure rather than losing their place. Otherwise falls back to
   * the oldest row, which is what a FULLY settled date's disappearance resolves to.
   */
  private selectDefault(): void {
    const kept = this.rows.find((r) => r.collectionDate === this.selectedDate) ?? null;
    const next = kept ?? this.rows[0] ?? null;
    this.selectedDate = next?.collectionDate ?? null;
    this.prefillFor(next);
  }

  select(row: UpiPendingDate): void {
    this.selectedDate = row.collectionDate;
    this.prefillFor(row);
    this.recordError = '';
    this.recorded = null;
  }

  /**
   * The full pending amount, which is what matches in every case but the rare partial.
   * Left blank when `pendingAmount` is negative — a correcting journal has already settled
   * more than this date owes (§8.3) — rather than prefilling a figure `parseRupees` can
   * never read back.
   */
  private prefillFor(row: UpiPendingDate | null): void {
    this.amountInput = row && row.pendingAmount > 0 ? groupedRupees(row.pendingAmount) : '';
    this.settledOnInput = todayIso();
  }

  get amount(): number | null {
    return parseRupees(this.amountInput);
  }

  get amountIsUnreadable(): boolean {
    return this.amountInput.trim() !== '' && this.amount === null;
  }

  /**
   * Pending − typed, in integer paise. Two JSON floats that should be equal sometimes are
   * not, so every comparison here goes through paise rather than subtracting rupees.
   */
  private get leftoverPaise(): number | null {
    const selected = this.selected;
    const amount = this.amount;
    if (!selected || amount === null) {
      return null;
    }
    return paise(selected.pendingAmount) - paise(amount);
  }

  get leftover(): number | null {
    const diff = this.leftoverPaise;
    return diff === null ? null : diff / 100;
  }

  get matchesExactly(): boolean {
    return this.leftoverPaise === 0;
  }

  /** The 422 §1.2 names: `settledAmount` greater than what is still pending for the date. */
  get amountTooHigh(): boolean {
    return (this.leftoverPaise ?? 0) < 0;
  }

  get settledOnBeforeCollection(): boolean {
    const selected = this.selected;
    return !!selected && !!this.settledOnInput && this.settledOnInput < selected.collectionDate;
  }

  get settledOnInFuture(): boolean {
    return !!this.settledOnInput && this.settledOnInput > todayIso();
  }

  onFieldChanged(): void {
    this.recordError = '';
    this.recorded = null;
  }

  get canRecord(): boolean {
    return (
      !!this.selected
      && !this.recording
      && this.amount !== null
      && this.amount > 0
      && !this.amountTooHigh
      && !!this.settledOnInput
      && !this.settledOnBeforeCollection
      && !this.settledOnInFuture
    );
  }

  record(): void {
    const selected = this.selected;
    const amount = this.amount;
    if (!selected || amount === null || !this.canRecord) {
      return;
    }

    this.recording = true;
    this.recordError = '';
    this.subscriptions.add(
      this.api
        .settleUpi(
          {
            collectionDate: selected.collectionDate,
            settledOn: this.settledOnInput,
            settledAmount: amount
          },
          this.idempotencyKey
        )
        .subscribe({
          next: (response) => this.settled(response),
          error: (error) => {
            this.recording = false;
            const replayed = asReplayedUpiSettlement(error);
            if (replayed) {
              // Not an error. The server answered 409 carrying the settlement that
              // already exists, so the operator gets the figures rather than a refusal.
              this.settled(replayed);
              return;
            }
            this.recordError = errorSentence(error);
          }
        })
    );
  }

  /**
   * Common to a `201` and a `409`: show what was recorded, then re-read the pending list —
   * `selectDefault` decides from the fresh figures whether the same date stays selected
   * (a partial residue) or the oldest remaining one takes over (a full settlement).
   */
  private settled(response: UpiSettlementResponse): void {
    this.recording = false;
    this.recorded = response;
    // A new action next, whether this attempt just succeeded or had already succeeded
    // under this key — either way, continuing to reuse it would carry the wrong identity
    // into whatever is typed next.
    this.idempotencyKey = newIdempotencyKey();
    this.load();
  }

  trackByDate(_index: number, row: UpiPendingDate): string {
    return row.collectionDate;
  }

  /** `Tuesday 7 Oct`. */
  dayWords(iso: string): string {
    const date = fromIso(iso);
    if (!date) {
      return iso;
    }
    return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  }

  ageWords(ageDays: number): string {
    if (ageDays <= 0) {
      return 'today';
    }
    return ageDays === 1 ? '1 day' : `${ageDays} days`;
  }
}

/**
 * Rupees as integer paise — see `close.component.ts`'s own copy of this for why.
 */
function paise(rupeeValue: number): number {
  return Math.round(rupeeValue * 100);
}

/**
 * What the operator typed, or `null` when it is not a figure.
 *
 * `₹` and thousands separators are accepted because the field is prefilled in that shape.
 */
export function parseRupees(input: string): number | null {
  const cleaned = (input ?? '').replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** `1,450` or `1,450.50` — grouped, with decimals only when the figure actually has paise. */
function groupedRupees(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString('en-US')
    : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isoOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function todayIso(): string {
  return isoOf(new Date());
}

/** An ISO day as a **local** date — `new Date('2026-10-07')` parses as UTC and reads back wrong. */
function fromIso(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!match) {
    return null;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
