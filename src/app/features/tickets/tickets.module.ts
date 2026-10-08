import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SectionChromeModule } from '../shared/section-chrome.module';
import { SectionPlaceholderComponent } from '../shared/section-placeholder/section-placeholder.component';
import { TicketsShellComponent } from './tickets-shell/tickets-shell.component';

/** Artboard 11. Two tabs, not the one screen the planning note expected. */
const routes: Routes = [
  {
    path: '',
    component: TicketsShellComponent,
    children: [
      { path: '', redirectTo: 'new', pathMatch: 'full' },
      {
        path: 'new',
        component: SectionPlaceholderComponent,
        data: {
          copy: {
            title: 'New booking',
            note: 'Artboard 11. Rail and bus are one business with one margin; the choice exists only because the old records cannot tell them apart.',
            slated: [
              'Rail or bus, and a typed passenger count — never divided out of the commission',
              'Who paid the platform, which is the one switch that hides the fare row',
              'Fare and our commission as separate fields',
              'The payment panel, the same component as the recharge counter'
            ]
          }
        }
      },
      {
        path: 'today',
        component: SectionPlaceholderComponent,
        data: {
          copy: {
            title: 'Today',
            note: 'The day’s bookings. The ticket till shares a drawer with recharge, so it is counted in the same evening close.',
            slated: ['Today’s bookings and what each earned', 'The way through to correcting one']
          }
        }
      }
    ]
  }
];

@NgModule({
  imports: [SectionChromeModule, RouterModule.forChild(routes)],
  declarations: [TicketsShellComponent]
})
export class TicketsModule {}
