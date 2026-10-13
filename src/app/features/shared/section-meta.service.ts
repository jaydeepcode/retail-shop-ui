import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';
import { UserDetailService } from '../../services/UserDetailService';

/** The right-hand context line in a section's dark bar, e.g. 'FY 2026-27 · Tue 7 Oct · Jaydeep'. */
@Injectable({ providedIn: 'root' })
export class SectionMetaService {
  private readonly name$: Observable<string>;

  /**
   * The server's own financial year, once a section that has one has read it.
   *
   * ⚠ The browser must not be the authority on this. `CounterConfigResponse` carries
   * `currentFinancialYear` and `fyStartMonth`, and `design-api.md` §3.6 makes the year
   * unbypassable by the API's shape — so a client that derives its own can disagree with
   * the server about which year a sale lands in. The local derivation below stays only as
   * the fallback for sections with no config endpoint (credit, tickets, the day's end),
   * and it is replaced the moment a real figure arrives.
   */
  private readonly serverFinancialYear$ = new BehaviorSubject<string | null>(null);

  constructor(private userDetails: UserDetailService) {
    // Already loaded by the dashboard on the way in; nothing is fetched here.
    this.name$ = userDetails.userDetail$.pipe(map((user) => (user?.firstName ?? '').trim()));
  }

  /** Called by a section that has read `/recharge/config`. Idempotent. */
  useServerFinancialYear(financialYear: string): void {
    if (financialYear && financialYear !== this.serverFinancialYear$.value) {
      this.serverFinancialYear$.next(financialYear);
    }
  }

  /**
   * @param withFinancialYear the day's end bar omits it (artboard 9), the rest carry it
   * @param withDate the credit book shows the operator alone (artboard 8)
   */
  line(withFinancialYear = true, withDate = true): Observable<string> {
    return combineLatest([this.name$, this.serverFinancialYear$]).pipe(
      map(([name, serverFinancialYear]) => {
        const now = new Date();
        const parts: string[] = [];
        if (withFinancialYear) {
          // The server's figure when a section has one; the local derivation otherwise.
          parts.push(
            serverFinancialYear ? `FY ${serverFinancialYear}` : this.financialYear(now)
          );
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

  /**
   * The Indian financial year the date falls in: April to March.
   *
   * The fallback only — see `serverFinancialYear$`. It hard-codes an April start, which
   * `CounterConfigResponse.fyStartMonth` makes configurable, so it is wrong the day that
   * setting changes. Sections that can read the config do.
   */
  private financialYear(on: Date): string {
    const startYear = on.getMonth() >= 3 ? on.getFullYear() : on.getFullYear() - 1;
    return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  }
}
