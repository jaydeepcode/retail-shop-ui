import { Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { UserDetailService } from '../../services/UserDetailService';

/** The right-hand context line in a section's dark bar, e.g. 'FY 2026-27 · Tue 7 Oct · Jaydeep'. */
@Injectable({ providedIn: 'root' })
export class SectionMetaService {
  private readonly name$: Observable<string>;

  constructor(private userDetails: UserDetailService) {
    // Already loaded by the dashboard on the way in; nothing is fetched here.
    this.name$ = userDetails.userDetail$.pipe(map((user) => (user?.firstName ?? '').trim()));
  }

  /**
   * @param withFinancialYear the day's end bar omits it (artboard 9), the rest carry it
   * @param withDate the credit book shows the operator alone (artboard 8)
   */
  line(withFinancialYear = true, withDate = true): Observable<string> {
    return this.name$.pipe(
      map((name) => {
        const now = new Date();
        const parts: string[] = [];
        if (withFinancialYear) {
          parts.push(this.financialYear(now));
        }
        if (withDate) {
          parts.push(now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }));
        }
        if (name) {
          parts.push(name);
        }
        return parts.join(' · ');
      })
    );
  }

  /** The Indian financial year the date falls in: April to March. */
  private financialYear(on: Date): string {
    const startYear = on.getMonth() >= 3 ? on.getFullYear() : on.getFullYear() - 1;
    return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  }
}
