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
 * What the till reconciles against:
 *
 *     the recharge till today  =  cashCollectedToday  ==  tenderMix.CASH − cashPaidOutToday
 *
 * ⚠ THE THIRD TERM IS NOT OPTIONAL, and omitting it is how this screen accused a correct
 * day of a mismatch. The identity was two terms for as long as money could only come IN.
 * `ck_txnpay_amount CHECK (AMOUNT > 0)` makes a negative tender line unrepresentable —
 * V12's way of saying the tender rows record what was COLLECTED and never the net of a
 * visit — so a refund moves the ledger figure and leaves the tender figure alone. Driving
 * one refund through a running backend read 849 against 1199, and no test caught it
 * because every fixture was a day with no refund in it.
 *
 * Still two INDEPENDENT readings: the day's `CASH_RECHARGE` net movement from the ledger
 * against today's tender rows less today's pay-outs, which come from different tables. A
 * disagreement means a posting is wrong rather than a count being off. The subtraction is
 * the only arithmetic on this screen, and it is here rather than server-side because both
 * terms are already on the wire — but neither TERM is computed here, which is what matters,
 * because this panel got that wrong twice:
 *
 *   1. It shipped summing `totalTakings + heldPending`, which omitted our own charge.
 *      `totalTakings` is the recharge FACE VALUE and the surcharge is deliberately its own
 *      income line (log §10.2, §15.11), so a ₹240 Dish TV recharge with the ₹10 fee puts
 *      ₹250 in the till while takings report ₹240 — under-stating the figure by ₹10 per DTH
 *      recharge, every day, on the one number the slice's gate exists to compare.
 *   2. The first fix, `totalCollected + heldPending`, was still wrong twice over.
 *      `heldPending` has NO date filter, so a recharge left unresolved overnight corrupts
 *      every later day; and it counts UPI and credit settlements, which never reached the
 *      drawer at all.
 *
 * Both balanced only for same-day, all-cash baskets — the shape of every fixture and of
 * every manual check. Caught by code review and confirmed by execution.
 *
 * ⚠ `heldPending` is therefore NOT part of the till figure. It is the all-time, all-tender
 * open exposure, which is what log §7.2 built `RCHG_PENDING` to be. It EXPLAINS why takings
 * sit below cash collected; it does not balance against anything here. The warning reads
 * "₹X held against N unresolved recharges" and must NEVER read "till mismatch".
 *
 * `totalCollected` is still shown — it is the day's recognised income, takings plus our
 * charges — and `totalSurcharge` stays broken out as well, because it is 60% of DTH margin
 * (FY2026-27 ₹2,957 against ₹2,009 of operator commission) and folding it into takings
 * would destroy the only check there is on the operator-paid rate.
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
   * What the books say the recharge till holds today: the gate's left-hand figure.
   *
   * ⚠ READ, NOT COMPUTED, and that is the fix. Every arithmetic version of this figure has
   * been wrong — see the class comment. The server reads the day's `CASH_RECHARGE` movement
   * from the ledger and sends it; this getter exists only to give the template a name and a
   * zero default.
   */
  get booksExpect(): number {
    return this.summary?.cashCollectedToday ?? 0;
  }

  /**
   * Whether the two independent readings of today's cash agree.
   *
   * The ledger's net `CASH_RECHARGE` movement against today's cash tender rows LESS what
   * went back out. The two sides come from different tables, so a disagreement means a
   * posting is wrong rather than a count being off — which is worth surfacing on the one
   * screen that exists to be trusted against a physical drawer.
   *
   * ⚠ `cashPaidOutToday` belongs on the TENDER side of this comparison, not the ledger
   * side. `cashCollectedToday` is already net of it; subtracting it from both would make a
   * refund day disagree by exactly the refund.
   *
   * Paise compared as integers, because two JSON floats that should be equal sometimes are
   * not.
   */
  get tillSourcesAgree(): boolean {
    if (!this.summary) {
      return true;
    }
    const fromTenders = Math.round((this.summary.tenderMix.CASH ?? 0) * 100)
      - Math.round((this.summary.cashPaidOutToday ?? 0) * 100);
    return Math.round(this.summary.cashCollectedToday * 100) === fromTenders;
  }

  /** Whether any cash went back over the counter today. Zero on most days. */
  get hasPaidOut(): boolean {
    return !!this.summary && this.summary.cashPaidOutToday > 0;
  }

  get paidOut(): number {
    return this.summary?.cashPaidOutToday ?? 0;
  }

  /**
   * Today's cash tender rows, gross — what was collected before anything went back.
   *
   * Shown beside the pay-out on a refund day so the two terms of the identity are both on
   * the screen. A staff member counting the drawer has to know ₹350 left it.
   */
  get cashTakenGross(): number {
    return this.summary?.tenderMix.CASH ?? 0;
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
