import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { SectionMetaService } from '../../shared/section-meta.service';
import { SectionTab } from '../../shared/section-tab';
import { AccountsApiService } from '../services/accounts-api.service';

/** The frame behind artboards 9-10. */
@Component({
  selector: 'app-accounts-shell',
  templateUrl: './accounts-shell.component.html',
  styleUrl: './accounts-shell.component.scss'
})
export class AccountsShellComponent implements OnInit, OnDestroy {
  readonly tabs: SectionTab[] = [
    { label: 'Count the drawer', link: 'close' },
    // The count is how many collection dates are still in transit — see `refreshUpiBadge`.
    { label: 'UPI', link: 'upi', badgeTone: 'warn' },
    { label: 'Expenses', link: 'expenses' },
    // The artboard's label; the planning note calls the same screen 'transfers', which is the route.
    { label: 'Move money', link: 'transfers' },
    { label: 'Reports', link: 'reports' }
  ];

  meta = '';

  private subscriptions = new Subscription();

  constructor(
    private router: Router,
    private sectionMeta: SectionMetaService,
    private api: AccountsApiService
  ) {}

  ngOnInit(): void {
    // Artboard 9's bar reads 'Tue 7 Oct · jaydeep' — no financial year on this section.
    this.subscriptions.add(this.sectionMeta.line(false).subscribe((line) => (this.meta = line)));

    this.refreshUpiBadge();
    this.subscriptions.add(
      this.router.events
        .pipe(filter((event) => event instanceof NavigationEnd))
        .subscribe(() => this.refreshUpiBadge())
    );
  }

  /**
   * How many collection dates are still waiting on a bank credit — endpoint 5, re-read on
   * every move inside the section, the same pattern `RechargeShellComponent` follows for
   * its worklist: settling a date from the UPI tab changes the count, and the bar is
   * always on screen. Zero is left `undefined` so the bar shows nothing — this is the
   * normal state, per the UPI tab's own u1 note, not a state to flag.
   */
  private refreshUpiBadge(): void {
    this.subscriptions.add(
      this.api.upiPending().subscribe({
        next: (pending) => {
          const upi = this.tabs.find((tab) => tab.link === 'upi');
          if (upi) {
            upi.badge = pending.dates.length > 0 ? pending.dates.length : undefined;
          }
        },
        error: () => undefined
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}
