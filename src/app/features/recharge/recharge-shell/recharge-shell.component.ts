import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { SectionMetaService } from '../../shared/section-meta.service';
import { SectionTab } from '../../shared/section-tab';

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
    // The count arrives with the worklist endpoint; the bar renders it once there is one.
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

  constructor(private router: Router, private route: ActivatedRoute, private sectionMeta: SectionMetaService) {}

  ngOnInit(): void {
    this.subscriptions.add(this.sectionMeta.line().subscribe((line) => (this.meta = line)));

    this.syncFloatStrip();
    this.subscriptions.add(
      this.router.events
        .pipe(filter((event) => event instanceof NavigationEnd))
        .subscribe(() => this.syncFloatStrip())
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
