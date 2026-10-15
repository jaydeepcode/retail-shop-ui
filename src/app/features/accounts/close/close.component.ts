import { Component } from '@angular/core';

/**
 * `/accounts/close` — artboard 9, half built.
 *
 * The recharge day summary above is real and is the slice's gate
 * (`implementation-plan.md:125`, "compare the day summary to the drawer"). Everything
 * else artboard 9 draws — the count, the difference, the four reasons, the sweep, and
 * closing the day itself — needs the ledger close endpoints of `design-ledger-api.md`
 * §1.3, which this slice did not build, so the placeholder below still names them.
 *
 * Both are shown together on purpose: a screen that silently dropped the unbuilt half
 * would read as finished.
 */
@Component({
  selector: 'app-close',
  template: `
    <app-day-summary></app-day-summary>
    <app-section-placeholder></app-section-placeholder>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
    `
  ]
})
export class CloseComponent {}
