import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { SectionMetaService } from '../../shared/section-meta.service';
import { SectionTab } from '../../shared/section-tab';

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

  constructor(private sectionMeta: SectionMetaService) {}

  ngOnInit(): void {
    this.subscriptions.add(this.sectionMeta.line().subscribe((line) => (this.meta = line)));
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}
