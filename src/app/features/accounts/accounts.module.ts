import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { SectionChromeModule } from '../shared/section-chrome.module';
import { SectionPlaceholderComponent } from '../shared/section-placeholder/section-placeholder.component';
import { AccountsShellComponent } from './accounts-shell/accounts-shell.component';
import { CloseComponent } from './close/close.component';
import { DaySummaryComponent } from './day-summary/day-summary.component';
import { TransfersComponent } from './transfers/transfers.component';
import { UpiComponent } from './upi/upi.component';

/** Artboards 9, 10, 12 (right-hand panel) and 13, plus the two screens of FRD §9 not drawn yet. */
const routes: Routes = [
  {
    path: '',
    component: AccountsShellComponent,
    children: [
      { path: '', redirectTo: 'close', pathMatch: 'full' },
      // ⚠ No `copy` any more: the placeholder this route carried copy for is gone, replaced
      // rather than kept beside the built half. The screen is artboard 9 whole — the count,
      // the difference, the four reasons, the sweep and closing the day.
      { path: 'close', component: CloseComponent },
      // ⚠ No `copy` any more, for the same reason `close` carries none: the placeholder
      // this route stood for is gone, replaced rather than kept beside it. Endpoints 5
      // and 6 of §1.2 — what is still in transit, and recording what the bank credited.
      { path: 'upi', component: UpiComponent },
      {
        path: 'expenses',
        component: SectionPlaceholderComponent,
        data: {
          copy: {
            title: 'Expenses',
            note: 'FRD §9. Not drawn in v10 — the artboards cover the close and the UPI settlement only.',
            slated: ['Recording an expense against a category', 'Which drawer or account it came out of']
          }
        }
      },
      // ⚠ No `copy` any more, for the same reason `close` and `upi` carry none: the
      // placeholder this route stood for is gone, replaced rather than kept beside it.
      // Endpoint 8 (artboard 13, whole) and endpoint 19's capture form only (artboard 12's
      // right-hand panel) — the wallet-versus-portal check on artboard 12's left is
      // endpoint 4 and a separate session's work.
      { path: 'transfers', component: TransfersComponent },
      {
        path: 'reports',
        component: SectionPlaceholderComponent,
        data: {
          copy: {
            title: 'Reports',
            note: 'P&L and balance sheet, per FRD §8.4:245. Not drawn in v10.',
            slated: ['P&L by business', 'Balance sheet', 'The year filter, which only these and history accept']
          }
        }
      }
    ]
  }
];

@NgModule({
  imports: [SectionChromeModule, FormsModule, RouterModule.forChild(routes)],
  declarations: [AccountsShellComponent, CloseComponent, DaySummaryComponent, TransfersComponent, UpiComponent]
})
export class AccountsModule {}
