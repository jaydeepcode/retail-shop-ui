import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { SectionMetaService } from '../../shared/section-meta.service';
import { SectionTab } from '../../shared/section-tab';
import { RechargeApiService } from '../services/recharge-api.service';

/** The frame behind artboards 1-8: the dark bar, the float strip, and the screen below. */
@Component({
  selector: 'app-recharge-shell',
  templateUrl: './recharge-shell.component.html',
  styleUrl: './recharge-shell.component.scss'
})
export class RechargeShellComponent implements OnInit, OnDestroy {
  /** Array order is the keyboard map. Failures is not here: it lives inside the
   *  worklist, which is where artboard 5 keeps the highlight while sorting one out. */
  readonly tabs: SectionTab[] = [
    { label: 'Counter', link: 'counter' },
    // The badge is everything in the tray: set aside plus unresolved failures. Normally
    // nothing, so `badge` stays undefined and the bar renders no dot at all.
    { label: 'Worklist', link: 'worklist', badgeTone: 'warn' },
    // History carries no badge — nothing in it is ever pending.
    { label: 'History', link: 'history' },
    { label: 'Float top-up', link: 'float' },
    { label: 'Rates', link: 'rates' }
  ];

  /** The four wallets of §2.4. Balances are not stubbed with figures — see the template. */
  readonly wallets = ['Airtel', 'Vi', 'Jio', 'A1Topup'];

  meta = '';
  showFloatStrip = true;

  private subscriptions = new Subscription();

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private sectionMeta: SectionMetaService,
    private api: RechargeApiService
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(this.sectionMeta.line().subscribe((line) => (this.meta = line)));

    // The bar's financial year comes from the server, not from the browser's clock.
    this.subscriptions.add(
      this.api.config().subscribe({
        next: (config) => this.sectionMeta.useServerFinancialYear(config.currentFinancialYear),
        // The bar falls back to its own derivation; the screens report their own failures.
        error: () => undefined
      })
    );

    this.refreshWorklistBadge();

    this.syncFloatStrip();
    this.subscriptions.add(
      this.router.events
        .pipe(filter((event) => event instanceof NavigationEnd))
        .subscribe(() => {
          this.syncFloatStrip();
          // Re-read on every move inside the section: completing a recharge from the
          // counter or the tray changes the count, and the bar is always on screen.
          this.refreshWorklistBadge();
        })
    );
  }

  /**
   * Everything still in the tray — set aside plus unresolved failures.
   *
   * Taken from the day summary, which reports both counts, rather than from the length of
   * two paged lists. A badge of zero is left undefined so the bar shows nothing: the tray
   * is normally empty, and a permanent "0" would make the normal state look like a state.
   */
  private refreshWorklistBadge(): void {
    this.subscriptions.add(
      this.api.daySummary().subscribe({
        next: (summary) => {
          const waiting = summary.awaitingCount + summary.unresolvedFailureCount;
          const worklist = this.tabs.find((tab) => tab.link === 'worklist');
          if (worklist) {
            worklist.badge = waiting > 0 ? waiting : undefined;
          }
        },
        error: () => undefined
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  /** Artboards 1 and 4 carry the strip; artboard 5, sorting out one failure, does not. */
  private syncFloatStrip(): void {
    this.showFloatStrip = this.route.firstChild?.snapshot.data['floatStrip'] !== false;
  }
}
