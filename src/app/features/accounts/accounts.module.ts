import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { SectionChromeModule } from '../shared/section-chrome.module';
import { SectionPlaceholderComponent } from '../shared/section-placeholder/section-placeholder.component';
import { AccountsShellComponent } from './accounts-shell/accounts-shell.component';
import { CloseComponent } from './close/close.component';
import { DaySummaryComponent } from './day-summary/day-summary.component';

/** Artboards 9-10, plus the three screens of FRD §9 that are not drawn yet. */
const routes: Routes = [
  {
    path: '',
    component: AccountsShellComponent,
    children: [
      { path: '', redirectTo: 'close', pathMatch: 'full' },
      {
        path: 'close',
        component: CloseComponent,
        data: {
          copy: {
            title: 'Still to build on this screen',
            note: 'Artboard 9. The recharge figures above are real; the rest needs the ledger close endpoints, which are S5.',
            slated: [
              'What is actually in the drawer, typed as one figure, and the difference against the books',
              'Can you say why: four reasons, two of them new because money can arrive as well as go missing',
              'What closing does — one record per business sharing the drawer, not one for the drawer',
              'The water drawer and the safe, counted separately',
              'Ticket’s own line of “the books say”, which needs a ticket module'
            ]
          }
        }
      },
      {
        path: 'upi',
        component: SectionPlaceholderComponent,
        data: {
          copy: {
            title: 'UPI settlement',
            note: 'Artboard 10. Settle what arrived, not what was expected. Nothing is ever written off automatically.',
            slated: [
              'Collection days waiting to be settled, and what the bank statement shows',
              'Recording twice against one collection day, which has to stay allowed'
            ]
          }
        }
      },
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
      {
        path: 'transfers',
        component: SectionPlaceholderComponent,
        data: {
          copy: {
            title: 'Move money',
            note: 'The contra transfers of FRD §9. Not drawn in v10.',
            slated: ['Moving cash between a drawer, the safe and a bank account', 'The ₹5 IMPS fee, kept out of a wallet’s cost']
          }
        }
      },
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
  declarations: [AccountsShellComponent, CloseComponent, DaySummaryComponent]
})
export class AccountsModule {}
