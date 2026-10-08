import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { SectionMetaService } from '../../shared/section-meta.service';

/**
 * The frame behind artboard 8. One screen, so the bar carries a line of its own
 * instead of tabs — and no Alt map, because there is nowhere else to go.
 */
@Component({
  selector: 'app-credit-shell',
  templateUrl: './credit-shell.component.html',
  styleUrl: './credit-shell.component.scss'
})
export class CreditShellComponent implements OnInit, OnDestroy {
  meta = '';

  private subscriptions = new Subscription();

  constructor(private sectionMeta: SectionMetaService) {}

  ngOnInit(): void {
    // Artboard 8's bar carries the operator alone: the credit book has no date and no year.
    this.subscriptions.add(this.sectionMeta.line(false, false).subscribe((line) => (this.meta = line)));
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}
