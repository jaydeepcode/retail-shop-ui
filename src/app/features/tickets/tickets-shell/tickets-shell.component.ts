import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { SectionMetaService } from '../../shared/section-meta.service';
import { SectionTab } from '../../shared/section-tab';
import { TicketApiService } from '../services/ticket-api.service';

/** The frame behind artboard 11. */
@Component({
  selector: 'app-tickets-shell',
  templateUrl: './tickets-shell.component.html',
  styleUrl: './tickets-shell.component.scss'
})
export class TicketsShellComponent implements OnInit, OnDestroy {
  readonly tabs: SectionTab[] = [
    { label: 'New booking', link: 'new' },
    // Today's bookings; the count arrives with the endpoint. Green rather than amber —
    // artboard 11 badges a tally, not a queue.
    { label: 'Today', link: 'today', badgeTone: 'ok' }
  ];

  meta = '';

  private subscriptions = new Subscription();

  constructor(private sectionMeta: SectionMetaService,
              private api: TicketApiService,
              private router: Router) {}

  ngOnInit(): void {
    this.subscriptions.add(this.sectionMeta.line().subscribe((line) => (this.meta = line)));

    this.refreshTodayBadge();
    this.subscriptions.add(
      this.router.events
        .pipe(filter((event) => event instanceof NavigationEnd))
        // Re-read on every move inside the section: taking a booking changes the count,
        // and the bar is always on screen.
        .subscribe(() => this.refreshTodayBadge())
    );
  }

  /**
   * The day's bookings.
   *
   * ⚠ A TALLY, NOT A QUEUE — which is why the tone is 'ok' and not 'warn'. The recharge
   * worklist badges work outstanding; nothing here is outstanding, because a booking is
   * complete the moment it is taken. An amber badge would read as "six things need
   * doing" when it means "six tickets sold".
   *
   * Zero is left undefined so the bar shows nothing rather than a permanent "0", which
   * is the same rule the worklist badge follows for the opposite reason: there, zero is
   * the normal state; here, it is simply early in the day.
   */
  private refreshTodayBadge(): void {
    this.subscriptions.add(
      this.api.daySummary().subscribe({
        next: (summary) => {
          const today = this.tabs.find((tab) => tab.link === 'today');
          if (today) {
            today.badge = summary.bookings > 0 ? summary.bookings : undefined;
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
