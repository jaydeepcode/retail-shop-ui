import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SectionChromeModule } from '../shared/section-chrome.module';
import { SectionPlaceholderComponent } from '../shared/section-placeholder/section-placeholder.component';
import { RechargeShellComponent } from './recharge-shell/recharge-shell.component';

/**
 * Artboards 1-8. The counter is the section's entry, not a search screen: FRD §8.7:316
 * keeps cash and UPI sales anonymous, so recharge does not copy water's find-the-person-first.
 */
const routes: Routes = [
  {
    path: '',
    component: RechargeShellComponent,
    children: [
      { path: '', redirectTo: 'counter', pathMatch: 'full' },
      {
        path: 'counter',
        component: SectionPlaceholderComponent,
        data: {
          copy: {
            title: 'Counter',
            note: 'Artboards 1-3. Entry and payment on one screen, because 94% of sales never need a second one.',
            slated: [
              'Mobile / TV (F1 / F2), the number field and its seen-before hint',
              'Operator chips, and amount presets that change with the operator',
              'The basket as a strip — no basket has ever held more than three',
              'The payment panel: one method by default, splitting opt-in, F12 to take payment',
              'Our charge as its own field, which design-api.md:318-331 is missing'
            ]
          }
        }
      },
      {
        path: 'worklist',
        component: SectionPlaceholderComponent,
        data: {
          copy: {
            title: 'Worklist',
            note: 'Artboard 4. The leftover tray, normally empty — 468 of 681 active hours held exactly one recharge.',
            slated: [
              'Set aside, still to do — the same two buttons as the counter (F8 went through, F9 failed)',
              'Failed, not yet sorted out, each row linking through to the screen below',
              'Money held against things not finished, never filtered by year'
            ],
            preview: {
              label: 'Look at the failure screen (it has no rows to link from yet) →',
              to: ['/recharge', 'worklist', 'example']
            }
          }
        }
      },
      {
        path: 'worklist/:failedId',
        component: SectionPlaceholderComponent,
        // Artboard 5 drops the float strip: a failed recharge consumes no float (§7.2:370).
        data: {
          floatStrip: false,
          copy: {
            title: 'Sorting out a failed recharge',
            note: 'Artboard 5. Under the worklist, which is why the Worklist tab stays lit while you are here.',
            slated: [
              'Try again at any amount, or give the whole payment back',
              'The leftover: handed back by default (no name needed), or kept for them (needs one)',
              'The rule the screen exists to protect — the retry rides on the payment already taken'
            ]
          }
        }
      },
      {
        path: 'history',
        component: SectionPlaceholderComponent,
        data: {
          copy: {
            title: 'History',
            note: 'Artboard 7. The only screen the financial-year filter touches — design-api.md:468-470 rejects the parameter everywhere else.',
            slated: [
              'The year filter, and the list it filters',
              'The way through to voiding a completed sale (artboard 6)'
            ]
          }
        }
      },
      {
        path: 'float',
        component: SectionPlaceholderComponent,
        data: {
          copy: {
            title: 'Float top-up',
            note: 'Artboard 12. Two backend pieces are missing before this works: §14.9 has the decision.',
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
            note: 'The commission rate table of FRD §9. A provisional rate replaced by a real one triggers the §8.4:709-710 correction.',
            slated: ['The rate table per operator and route', 'Editing a rate, and what that does to float already spent']
          }
        }
      }
    ]
  }
];

@NgModule({
  imports: [SectionChromeModule, RouterModule.forChild(routes)],
  declarations: [RechargeShellComponent]
})
export class RechargeModule {}
