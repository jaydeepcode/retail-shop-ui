import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { SectionChromeModule } from '../shared/section-chrome.module';
import { CreditBookComponent } from './credit-book/credit-book.component';
import { CreditShellComponent } from './credit-shell/credit-shell.component';

/**
 * Artboard 8. One screen: the list of who owes and the one person's tab sit side by side,
 * so there is nothing to navigate between. §14.8 is why the tab is per person and not
 * per business — someone owing ₹2,000 on water and ₹49 on recharge must not read as ₹49.
 *
 * The placeholder this replaced listed five things, four from #14 and #15 and the fifth —
 * taking a payment — deferred to #16. All five are built now.
 */
const routes: Routes = [
  {
    path: '',
    component: CreditShellComponent,
    // The shell carries artboard 8's bar, so the book stays a child of it rather than
    // replacing it — the bar is the only thing telling the staff which section they are in.
    children: [{ path: '', component: CreditBookComponent }]
  }
];

@NgModule({
  imports: [SectionChromeModule, FormsModule, RouterModule.forChild(routes)],
  declarations: [CreditShellComponent, CreditBookComponent]
})
export class CreditModule {}
