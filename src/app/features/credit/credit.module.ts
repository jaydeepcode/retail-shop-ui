import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SectionChromeModule } from '../shared/section-chrome.module';
import { SectionPlaceholderComponent } from '../shared/section-placeholder/section-placeholder.component';
import { CreditShellComponent } from './credit-shell/credit-shell.component';

/**
 * Artboard 8. One screen: the list of who owes and the one person's tab sit side by side,
 * so there is nothing to navigate between. §14.8 is why the tab is per person and not
 * per business — someone owing ₹2,000 on water and ₹49 on recharge must not read as ₹49.
 */
const routes: Routes = [
  {
    path: '',
    component: CreditShellComponent,
    children: [
      {
        path: '',
        component: SectionPlaceholderComponent,
        data: {
          copy: {
            title: 'Who owes us',
            note: 'One tab per person, across every business. A payment comes off the whole tab oldest-first, with no prompt.',
            slated: [
              'Owed to us, people, and how many are over 30 days',
              'Search by name or mobile, and the list ordered by oldest debt',
              'One person’s whole statement — every business on one list, newest first',
              'Taking a payment, and what they will owe after it',
              'People in credit rather than in debt, who can spend what they hold'
            ]
          }
        }
      }
    ]
  }
];

@NgModule({
  imports: [SectionChromeModule, RouterModule.forChild(routes)],
  declarations: [CreditShellComponent]
})
export class CreditModule {}
