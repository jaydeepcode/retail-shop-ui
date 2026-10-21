import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import {
  CounterConfigResponse,
  HistoryPageResponse,
  HistoryQuery,
  OperatorConfig,
  RechargeResponse,
  RechargeStatus
} from '../model/recharge.models';
import { RechargeApiService } from '../services/recharge-api.service';
import { errorSentence } from '../services/recharge-error';

/**
 * History — artboard 7, the only screen the financial-year filter touches.
 *
 * The year of a sale comes from its own date and can never be set by hand, so nothing
 * can be filed into the wrong year by leaving the filter somewhere. `design-api.md`
 * goes further: the worklist, the failures and the credit book do not accept the
 * parameter at all, so a client that tries gets an error rather than a wrong answer.
 *
 * ⚠ TWO EMPTY STATES, and they need different sentences.
 *
 * `availableYears: []` means nothing has been recorded yet. `/recharge/history` reads
 * `rc_recharge` alone — the owner settled this on 2026-10-12, "only new sales is fine
 * for recharge data" (§15.11 item 2) — and that table is empty until V15 runs at
 * cutover. So the screen is genuinely blank on day one and that is correct. Without
 * that distinction it reads as broken.
 *
 * `availableYears` non-empty but no rows means the filter matched nothing, which is an
 * ordinary result and says so.
 *
 * ⚠ What this screen CANNOT show, and why. Artboard 7 draws a `Payment` column
 * (`P-73484`) and a `Paid by` column ("Cash ₹300 · UPI ₹100 · Credit ₹49 — R. Pawar"),
 * grouping several recharges under one payment, plus footer totals for value and our
 * charges. `HistoryPageResponse` carries `PageResponse<RechargeResponse>`, and
 * `RechargeResponse` has no `paymentId` and no settlement lines — `RechargeWorkItemResponse`
 * has `paymentId`, the history DTO does not — and the page carries only `totalElements`.
 * So the table is per recharge, with no payment column and no value totals. Reported in
 * the session notes rather than papered over: the artboards and the built contract
 * disagree, and the rule is to say so rather than pick one.
 *
 * ⚠ Voiding is reached from here in artboard 7 ("Shouldn't exist? Void it") and has no
 * control. `/void` moves the status, which correctly drops the sale out of takings, but
 * the reversing voucher is not posted — `LedgerCorrectionRules` has no caller, which S2
 * left outstanding — so until then the ledger would overstate income after a void.
 */
@Component({
  selector: 'app-history',
  templateUrl: './history.component.html',
  styleUrl: './history.component.scss'
})
export class HistoryComponent implements OnInit, OnDestroy {
  config: CounterConfigResponse | null = null;
  result: HistoryPageResponse | null = null;

  loading = true;
  loadError = '';

  // -- the filter artboard 7 draws ----------------------------------------
  financialYear = '';
  /** A prefix match, not a contains. Name search is deliberately not offered. */
  numberPrefix = '';
  operatorCode = '';
  status: RechargeStatus | '' = '';
  page = 0;
  readonly size = 20;

  /**
   * ⚠ NO "Voided" OPTION since 2026-10-21, and only the FILTER came out.
   *
   * The void path was withdrawn (log §16.1), so `VOIDED` is now a status that is defined,
   * terminal and unreachable — nothing creates one, which makes a filter for it one that
   * can only ever return nothing. The rest of this component's `VOIDED` handling STAYS:
   * `statusLabel`, `statusTone` and the struck-through row in the template. The status is
   * still mapped on the wire and V9 still seeds the reference row, so if such a row ever
   * appeared from any source this screen must still render it honestly. Only the filter is
   * dead, because only the creation path is.
   */
  readonly statuses: { value: RechargeStatus | ''; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'COMPLETED', label: 'Done' },
    { value: 'AWAITING_RECHARGE', label: 'Waiting' },
    { value: 'FAILED', label: 'Failed' }
  ];

  private readonly numberProbe = new Subject<void>();
  private readonly subscriptions = new Subscription();

  constructor(private api: RechargeApiService) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.api.config().subscribe({
        next: (config) => {
          this.config = config;
          // The server's own idea of the current year, never derived in the browser.
          if (!this.financialYear) {
            this.financialYear = config.currentFinancialYear;
          }
          this.load();
        },
        error: () => this.load()
      })
    );

    this.subscriptions.add(
      this.numberProbe.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => {
        this.page = 0;
        this.load();
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get operators(): OperatorConfig[] {
    return this.config?.operators ?? [];
  }

  /**
   * The years the server says exist. Empty is the day-one signal, not a dropdown that
   * failed to populate.
   */
  get availableYears(): string[] {
    return this.result?.availableYears ?? [];
  }

  get rows(): RechargeResponse[] {
    return this.result?.page.content ?? [];
  }

  /** Nothing has ever been recorded — `rc_recharge` is empty until V15 runs. */
  get nothingRecordedYet(): boolean {
    return !!this.result && !this.availableYears.length && !this.rows.length;
  }

  /** Something exists, but not under this filter. An ordinary result. */
  get noMatches(): boolean {
    return !!this.result && !!this.availableYears.length && !this.rows.length;
  }

  get totalPages(): number {
    return this.result?.page.totalPages ?? 0;
  }

  get totalElements(): number {
    return this.result?.page.totalElements ?? 0;
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    const query: HistoryQuery = {
      financialYear: this.financialYear || undefined,
      number: this.numberPrefix.replace(/\D/g, '') || undefined,
      operatorCode: this.operatorCode || undefined,
      status: this.status || undefined,
      page: this.page,
      size: this.size
    };
    this.subscriptions.add(
      this.api.history(query).subscribe({
        next: (result) => {
          this.loading = false;
          this.result = result;
        },
        error: (error) => {
          this.loading = false;
          this.loadError = errorSentence(error);
        }
      })
    );
  }

  onFilterChange(): void {
    this.page = 0;
    this.load();
  }

  onNumberInput(value: string): void {
    this.numberPrefix = value;
    this.numberProbe.next();
  }

  goToPage(page: number): void {
    if (page < 0 || (this.totalPages && page >= this.totalPages)) {
      return;
    }
    this.page = page;
    this.load();
  }

  clearFilters(): void {
    this.numberPrefix = '';
    this.operatorCode = '';
    this.status = '';
    this.financialYear = this.config?.currentFinancialYear ?? '';
    this.page = 0;
    this.load();
  }

  /** The badge wording of artboard 7: DONE / WAITING / FAILED / VOIDED. */
  statusLabel(row: RechargeResponse): string {
    switch (row.status) {
      case 'COMPLETED':
        return 'DONE';
      case 'AWAITING_RECHARGE':
        return 'WAITING';
      case 'VOIDED':
        return 'VOIDED';
      case 'FAILED':
        return row.resolution === 'NONE' ? 'FAILED' : `FAILED · ${row.resolution}`;
    }
  }

  statusTone(row: RechargeResponse): string {
    switch (row.status) {
      case 'COMPLETED':
        return 'ok';
      case 'AWAITING_RECHARGE':
        return 'warn';
      case 'FAILED':
        return 'bad';
      case 'VOIDED':
        return 'muted';
    }
  }

  trackById(_index: number, row: RechargeResponse): number {
    return row.rechargeId;
  }
}
