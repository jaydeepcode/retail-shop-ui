import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  DaySummaryResponse,
  SettlementMethod,
  TakingsRow
} from '../../recharge/model/recharge.models';
import { RechargeApiService } from '../../recharge/services/recharge-api.service';
import { errorSentence } from '../../recharge/services/recharge-error';

/**
 * The recharge part of artboard 9's evening close.
 *
 * ⚠ This is the slice's GATE, not a report. `implementation-plan.md:125` states it:
 * "run real recharges on it alongside the legacy app, and compare the day summary to the
 * drawer." So the figure this screen has to make easy to compare is what the books expect
 * the recharge till to hold.
 *
 * The identity, which the backend asserts:
 *
 *     drawer  =  totalTakings  +  heldPending
 *
 * `totalTakings` counts COMPLETED rows only, so the till will NOT equal takings whenever
 * a recharge has failed and has not been refunded. ⚠ That is correct — the money is held,
 * not missing. `heldPending` is the `RCHG_PENDING` account balance, so the second term
 * reconciles rather than merely displays. The warning therefore reads "₹X held against N
 * unresolved recharges" and must NEVER read "till mismatch".
 *
 * `totalSurcharge` is reported separately and stays separate: it is 60% of DTH margin
 * (FY2026-27 ₹2,957 surcharge against ₹2,009 operator commission), and folding it into
 * takings would destroy the only check there is on the operator-paid rate.
 *
 * ⚠ WHAT IS NOT HERE, and why. Artboard 9 also draws the count input, the difference, the
 * four "can you say why" reasons, the sweep to the safe, "Close the drawer for today", the
 * water drawer and the safe. All of those need the ledger close endpoints of
 * `design-ledger-api.md` §1.3, which this slice did not build — treasury is S5
 * (`implementation-plan.md` §1). The route's placeholder still names them, and this panel
 * sits above it rather than replacing it, so the screen says plainly which half exists.
 *
 * It reads `/recharge/day-summary`, so it covers recharge alone. Artboard 9's "The books
 * say" box has a line per business sharing the drawer, and ticket's line has no endpoint
 * and no module yet.
 */
@Component({
  selector: 'app-day-summary',
  templateUrl: './day-summary.component.html',
  styleUrl: './day-summary.component.scss'
})
export class DaySummaryComponent implements OnInit, OnDestroy {
  summary: DaySummaryResponse | null = null;
  loading = true;
  loadError = '';

  /** `YYYY-MM-DD`. Defaults to today, and the server decides what "today" means. */
  date = '';

  private readonly subscriptions = new Subscription();

  constructor(private api: RechargeApiService) {}

  ngOnInit(): void {
    this.date = this.todayAsInputValue();
    this.load();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.subscriptions.add(
      this.api.daySummary(this.date || undefined).subscribe({
        next: (summary) => {
          this.loading = false;
          this.summary = summary;
        },
        error: (error) => {
          this.loading = false;
          this.loadError = errorSentence(error);
        }
      })
    );
  }

  /**
   * What the books expect the recharge till to hold: the gate's left-hand figure.
   *
   * Summed from the two terms the server sends rather than invented — neither term is
   * recomputed, and the sum is the identity the backend already asserts.
   */
  get booksExpect(): number {
    if (!this.summary) {
      return 0;
    }
    return (
      (Math.round(this.summary.totalTakings * 100) + Math.round(this.summary.heldPending * 100)) / 100
    );
  }

  get hasHeldMoney(): boolean {
    return !!this.summary && this.summary.heldPending > 0;
  }

  get unresolvedCount(): number {
    return this.summary?.unresolvedFailureCount ?? 0;
  }

  get awaitingCount(): number {
    return this.summary?.awaitingCount ?? 0;
  }

  get takings(): TakingsRow[] {
    return this.summary?.takings ?? [];
  }

  /**
   * The tender mix, in a fixed order, with the zero methods left out.
   *
   * ⚠ The map's keys are absent when zero, so a missing `UPI` means none was taken —
   * not that the figure failed to arrive.
   */
  get tenderMix(): { method: SettlementMethod; label: string; amount: number }[] {
    const mix = this.summary?.tenderMix ?? {};
    const order: { method: SettlementMethod; label: string }[] = [
      { method: 'CASH', label: 'Cash' },
      { method: 'UPI', label: 'UPI' },
      { method: 'CREDIT', label: 'On credit' }
    ];
    return order
      .filter((entry) => mix[entry.method] !== undefined)
      .map((entry) => ({ ...entry, amount: mix[entry.method] as number }));
  }

  /** Not every rupee of takings is in the drawer: UPI and credit never were. */
  get nonCashTaken(): number {
    const mix = this.summary?.tenderMix ?? {};
    const paise = Math.round((mix.UPI ?? 0) * 100) + Math.round((mix.CREDIT ?? 0) * 100);
    return paise / 100;
  }

  trackByRow(_index: number, row: TakingsRow): string {
    return `${row.operatorCode}:${row.routeCode}`;
  }

  private todayAsInputValue(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }
}
