import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { PaymentModule } from '../shared/payment/payment.module';
import { SectionChromeModule } from '../shared/section-chrome.module';
import { BookingComponent } from './booking/booking.component';
import { TicketsShellComponent } from './tickets-shell/tickets-shell.component';
import { TodayComponent } from './today/today.component';

/**
 * Artboard 11. Two tabs, not the one screen the planning note expected.
 *
 * ⚠ `PaymentModule` is imported rather than the settlement block being rebuilt. It is
 * the recharge counter's own component, extracted in this slice's first commit for
 * exactly this — "the same three buttons would have been built twice and behaved
 * differently" is the failure `design-ticket-booking.md` §4 names.
 */
const routes: Routes = [
  {
    path: '',
    component: TicketsShellComponent,
    children: [
      { path: '', redirectTo: 'new', pathMatch: 'full' },
      { path: 'new', component: BookingComponent },
      { path: 'today', component: TodayComponent }
    ]
  }
];

@NgModule({
  imports: [SectionChromeModule, PaymentModule, FormsModule, RouterModule.forChild(routes)],
  declarations: [TicketsShellComponent, BookingComponent, TodayComponent]
})
export class TicketsModule {}
