import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { SectionMetaService } from '../../shared/section-meta.service';
import { SectionTab } from '../../shared/section-tab';

/** The frame behind artboards 9-10. */
@Component({
  selector: 'app-accounts-shell',
  templateUrl: './accounts-shell.component.html',
  styleUrl: './accounts-shell.component.scss'
})
export class AccountsShellComponent implements OnInit, OnDestroy {
  readonly tabs: SectionTab[] = [
    { label: 'Count the drawer', link: 'close' },
    // The count arrives with the settlement endpoint.
    { label: 'UPI', link: 'upi', badgeTone: 'warn' },
    { label: 'Expenses', link: 'expenses' },
    // The artboard's label; the planning note calls the same screen 'transfers', which is the route.
    { label: 'Move money', link: 'transfers' },
    { label: 'Reports', link: 'reports' }
  ];

  meta = '';

  private subscriptions = new Subscription();

  constructor(private sectionMeta: SectionMetaService) {}

  ngOnInit(): void {
    // Artboard 9's bar reads 'Tue 7 Oct · jaydeep' — no financial year on this section.
    this.subscriptions.add(this.sectionMeta.line(false).subscribe((line) => (this.meta = line)));
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}
