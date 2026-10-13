import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Subscription, forkJoin } from 'rxjs';
import {
  CounterConfigResponse,
  MarkCompleteRequest,
  RechargeWorkItemResponse,
  RouteConfig
} from '../model/recharge.models';
import { RechargeApiService } from '../services/recharge-api.service';
import { errorSentence } from '../services/recharge-error';

/**
 * The worklist — artboard 4, "the leftover tray, not a queue".
 *
 * ⚠ The empty state is the MAIN state, not an edge case. §14.10 measured 468 of 681
 * active hours holding exactly one recharge, the busiest hour in six months holding 7,
 * and 89% of recharges having more than five minutes before the next. At six or seven a
 * day there is nothing to batch, so this screen is normally empty and says so in words
 * rather than showing a bare table with no rows.
 *
 * Complete is one recharge at a time. There is deliberately NO bulk complete-all: it
 * would let recharge 3 failing roll back recharges 1 and 2 (§4.4). Three at once means
 * three calls and three outcomes.
 *
 * It carries the same two buttons as the counter — F8 went through, F9 failed — so there
 * is one thing to learn and not two.
 */
@Component({
  selector: 'app-worklist',
  templateUrl: './worklist.component.html',
  styleUrl: './worklist.component.scss'
})
export class WorklistComponent implements OnInit, OnDestroy {
  config: CounterConfigResponse | null = null;

  awaiting: RechargeWorkItemResponse[] = [];
  failures: RechargeWorkItemResponse[] = [];

  loading = true;
  loadError = '';

  /** The row being picked up again, in the right-hand panel. */
  selected: RechargeWorkItemResponse | null = null;
  vendorRef = '';
  routeOverride = '';
  answering = false;
  answerError = '';

  private readonly subscriptions = new Subscription();

  constructor(private api: RechargeApiService) {}

  ngOnInit(): void {
    this.load();
    this.subscriptions.add(
      this.api.config().subscribe({
        next: (config) => (this.config = config),
        // The tray still works without it; only the route override needs the route list.
        error: () => (this.config = null)
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  /** Neither tray is ever filtered by financial year — anything open shows, whenever it started. */
  load(): void {
    this.loading = true;
    this.loadError = '';
    this.subscriptions.add(
      forkJoin({
        awaiting: this.api.awaiting(0, 50),
        failures: this.api.failures(0, 50)
      }).subscribe({
        next: ({ awaiting, failures }) => {
          this.loading = false;
          this.awaiting = awaiting?.content ?? [];
          this.failures = failures?.content ?? [];
          // A row that has been answered elsewhere must not stay selected.
          if (this.selected && !this.awaiting.some((r) => r.rechargeId === this.selected!.rechargeId)) {
            this.selected = null;
          }
          if (!this.selected && this.awaiting.length) {
            this.select(this.awaiting[0]);
          }
        },
        error: (error) => {
          this.loading = false;
          this.loadError = errorSentence(error);
        }
      })
    );
  }

  get isEmpty(): boolean {
    return !this.loading && !this.loadError && !this.awaiting.length && !this.failures.length;
  }

  /**
   * The money held against things not finished.
   *
   * Summed from the rows for this tray's own line. The authoritative figure is the day
   * summary's `heldPending`, which is the `RCHG_PENDING` account balance and therefore
   * reconciles — this is the same money described per row, not a second opinion on it.
   */
  get heldHere(): number {
    const rows = [...this.awaiting, ...this.failures];
    const paise = rows.reduce(
      (sum, row) => sum + Math.round(row.amount * 100) + Math.round(row.surcharge * 100),
      0
    );
    return paise / 100;
  }

  get failuresHeld(): number {
    const paise = this.failures.reduce(
      (sum, row) => sum + Math.round(row.amount * 100) + Math.round(row.surcharge * 100),
      0
    );
    return paise / 100;
  }

  select(row: RechargeWorkItemResponse): void {
    this.selected = row;
    this.vendorRef = '';
    this.routeOverride = '';
    this.answerError = '';
  }

  routeNameOf(code: string): string {
    return this.config?.routes.find((route) => route.code === code)?.name ?? code;
  }

  get otherRoutes(): RouteConfig[] {
    if (!this.selected || !this.config) {
      return [];
    }
    return this.config.routes.filter((route) => route.code !== this.selected!.routeCode);
  }

  // The same two buttons as the counter, and the same keys.
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || !this.selected) {
      return;
    }
    if (event.key === 'F8') {
      event.preventDefault();
      this.markDone();
    } else if (event.key === 'F9') {
      event.preventDefault();
      this.markFailed();
    }
  }

  markDone(): void {
    const row = this.selected;
    if (!row || this.answering) {
      return;
    }
    this.answering = true;
    this.answerError = '';
    // Keys are left out rather than set to undefined, so the body carries only what was
    // actually answered — the route override is the §14.6 moment and nothing else.
    const request: MarkCompleteRequest = {};
    if (this.vendorRef.trim()) {
      request.vendorRef = this.vendorRef.trim();
    }
    if (this.routeOverride) {
      request.routeCode = this.routeOverride;
    }
    this.api
      .complete(row.rechargeId, request)
      .subscribe({
        next: () => this.afterAnswer(),
        error: (error) => {
          this.answering = false;
          this.answerError = errorSentence(error);
        }
      });
  }

  markFailed(): void {
    const row = this.selected;
    if (!row || this.answering) {
      return;
    }
    this.answering = true;
    this.answerError = '';
    this.api.fail(row.rechargeId, {}).subscribe({
      next: () => this.afterAnswer(),
      error: (error) => {
        this.answering = false;
        this.answerError = errorSentence(error);
      }
    });
  }

  private afterAnswer(): void {
    this.answering = false;
    this.selected = null;
    // Re-read rather than splice: a failure answered here moves between the two trays,
    // and the server is the only thing that knows which one it landed in.
    this.load();
  }

  trackById(_index: number, row: RechargeWorkItemResponse): number {
    return row.rechargeId;
  }
}
