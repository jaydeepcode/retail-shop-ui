import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { PaymentModule } from '../shared/payment/payment.module';
import { SectionChromeModule } from '../shared/section-chrome.module';
import { SectionPlaceholderComponent } from '../shared/section-placeholder/section-placeholder.component';
import { CounterComponent } from './counter/counter.component';
import { FailureComponent } from './failure/failure.component';
import { HistoryComponent } from './history/history.component';
import { NumberGroupsPipe } from './number-groups.pipe';
import { RechargeShellComponent } from './recharge-shell/recharge-shell.component';
import { WorklistComponent } from './worklist/worklist.component';

/**
 * Artboards 1-8. The counter is the section's entry, not a search screen: FRD §8.7:316
 * keeps cash and UPI sales anonymous, so recharge does not copy water's
 * find-the-person-first.
 *
 * ⚠ `float` and `rates` stay placeholders, and that is a decision rather than a gap.
 * §14.9 found the float top-up endpoint does not exist at all —
 * `design-ledger-api.md` §1.3 ships manual endpoints for payments, contras and journals
 * and never mentions Purchase — and treasury is S5 in `implementation-plan.md` §1.
 */
const routes: Routes = [
  {
    path: '',
    component: RechargeShellComponent,
    children: [
      { path: '', redirectTo: 'counter', pathMatch: 'full' },
      { path: 'counter', component: CounterComponent },
      { path: 'worklist', component: WorklistComponent },
      {
        path: 'worklist/:failedId',
        component: FailureComponent,
        // Artboard 5 drops the float strip: a failed recharge consumes no float (§7.2:370).
        data: { floatStrip: false }
      },
      { path: 'history', component: HistoryComponent },
      {
        path: 'float',
        component: SectionPlaceholderComponent,
        data: {
          copy: {
            title: 'Float top-up',
            note: 'Artboard 12. Two backend pieces are missing before this works: §14.9 has the decision. S5, not S3.',
            slated: [
              'The four wallets and what the books say each holds',
              'A top-up, which needs the Purchase endpoint that does not exist yet',
              'The portal figure, read and typed by hand — there is no vendor API',
              'A correction, posted by the float-close endpoint and never the generic journal one'
            ]
          }
        }
      },
      {
        path: 'rates',
        component: SectionPlaceholderComponent,
        data: {
          copy: {
            title: 'Rates',
            note: 'The commission rate table of FRD §9. A provisional rate replaced by a real one triggers the §8.4:709-710 correction. S5, not S3.',
            slated: [
              'The rate table per operator and route',
              'Editing a rate, and what that does to float already spent',
              'Three provisional direct rates and BIGTV at a provisional zero still need the owner (§15.7)'
            ]
          }
        }
      }
    ]
  }
];

@NgModule({
  imports: [SectionChromeModule, PaymentModule, FormsModule, RouterModule.forChild(routes)],
  declarations: [
    RechargeShellComponent,
    CounterComponent,
    WorklistComponent,
    FailureComponent,
    HistoryComponent,
    NumberGroupsPipe
  ]
})
export class RechargeModule {}
