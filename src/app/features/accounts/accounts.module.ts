import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SectionChromeModule } from '../shared/section-chrome.module';
import { SectionPlaceholderComponent } from '../shared/section-placeholder/section-placeholder.component';
import { AccountsShellComponent } from './accounts-shell/accounts-shell.component';

/** Artboards 9-10, plus the three screens of FRD §9 that are not drawn yet. */
const routes: Routes = [
  {
    path: '',
    component: AccountsShellComponent,
    children: [
      { path: '', redirectTo: 'close', pathMatch: 'full' },
      {
        path: 'close',
        component: SectionPlaceholderComponent,
        data: {
          copy: {
            title: 'Count the drawer',
            note: 'Artboard 9. The screen that arms every correction rule — until it is used, nothing is ever sealed.',
            slated: [
              'What the books say, what is actually in the drawer, and the difference',
              'Can you say why: four reasons, two of them new because money can arrive as well as go missing',
              'What closing does — one record per business sharing the drawer, not one for the drawer',
              'The water drawer and the safe, counted separately'
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
  imports: [SectionChromeModule, RouterModule.forChild(routes)],
  declarations: [AccountsShellComponent]
})
export class AccountsModule {}
