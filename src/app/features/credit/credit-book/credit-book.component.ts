import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, Subscription, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import {
  CreditBookRowResponse,
  CreditCustomerResponse,
  CreditStatementResponse,
  StatementLineResponse
} from '../../recharge/model/recharge.models';
import { RechargeApiService } from '../../recharge/services/recharge-api.service';
import { errorSentence } from '../../recharge/services/recharge-error';

/**
 * One row of the list, from either of the two endpoints that can fill it.
 *
 * `lastActivityAt` is null for a search result, because `GET /recharge/customers` does not
 * carry it — stated here rather than faked, so the column can be left empty instead of
 * showing a date that was never sent.
 */
interface BookRow {
  customerId: number;
  name: string;
  contactNumber: string;
  outstanding: number;
  advanceHeld: number;
  oldestDebtDays: number | null;
  warn: boolean;
  lastActivityAt: string | null;
}

/** How big a page of the book to ask for. The server caps `size` at 100. */
const BOOK_PAGE_SIZE = 100;

/**
 * Artboard 8 — who owes the shop money, and one person's tab beside it (#14 and #15).
 *
 * ⚠ EVERY FIGURE HERE IS CROSS-BUSINESS AND NEVER YEAR-FILTERED, which is the whole point
 * of the panel. log §14.8: scoped to recharge, someone owing ₹2,000 on water and ₹49 on
 * recharge would show as ₹49, so the `warn` flag would understate the exposure while
 * looking authoritative. §9.3 names what a year filter costs: 33 of 34 open balances
 * vanish and staff stop chasing debt.
 *
 * ⚠ `outstanding` and `advanceHeld` are both POSITIVE and only one is ever non-zero. This
 * is one netted position per person, which the screen shows as "owes ₹120" or "has ₹80
 * with us" — never as two numbers side by side. `runningBalance` on a statement line is
 * the one signed figure in the API.
 *
 * ⚠ `warn` and `oldestDebtDays` are computed server-side and are NOT re-derived here. The
 * 30-day rule lives in one place so two clients cannot disagree about who is overdue —
 * and the query behind it is subtler than it looks (`CreditBookRepository.java:74-102`:
 * a receipt and a charge in the same second used to make the badge go dark).
 *
 * ⚠ TAKING A PAYMENT IS NOT HERE, and that is a decision rather than an omission. #16 is
 * deferred to S6 with its design settled in `implementation-plan.md` §0.7: a receipt must
 * clear the customer's `AR_*` legs oldest-first, each of which names its own business, and
 * the ledger does not hold legacy debt until the opening balances land (V30/V31). A
 * tally-first version built against these two read endpoints would post water debt to
 * `AR_RECHARGE`. So this screen reads and does not collect, and says so on the screen.
 *
 * ⚠ AN ADVANCE KEPT FROM A REFUND DOES NOT APPEAR HERE, and that is a backend gap rather
 * than a display one. `KEEP_AS_ADVANCE` posts a ledger leg to `ADV_RECHARGE` with the
 * customer as party (`RechargeLedgerPostings.java:426`); this book and the statement read
 * `rc_credit_req`, which that path never writes. So the failure screen can tell a customer
 * "₹250 kept on your account" and this screen — the one whose whole job is each person's
 * position — shows them holding nothing. Observed against a running backend: Asha Kale,
 * ₹250 kept, `advanceHeld` 0.00 and an empty statement.
 *
 * It is NOT worked around here. Netting a ledger balance into these figures on the client
 * would be a second formula for a number the server owns, which is the one thing every
 * screen in this slice is built not to do — and it would disagree with the counter's
 * credit panel, which reads the same `positionOf`. Reported for the backend to settle.
 *
 * ⚠ THE LIST AND THE SEARCH COME FROM DIFFERENT ENDPOINTS, because #14 has no query
 * parameter. Browsing is #14 (`/credit/customers`), ordered oldest-debt-first with nulls
 * last so the people carrying an advance cannot sit above a 40-day debtor. Searching is #4
 * (`/recharge/customers?query=`), which the counter already uses — it matches on name or
 * mobile and so can return someone who is settled up, which the rows say plainly rather
 * than hiding.
 */
@Component({
  selector: 'app-credit-book',
  templateUrl: './credit-book.component.html',
  styleUrl: './credit-book.component.scss'
})
export class CreditBookComponent implements OnInit, OnDestroy {
  rows: BookRow[] = [];
  /** `totalElements` from the book page: how many people have a tab at all. */
  peopleOnBook = 0;
  loading = true;
  loadError = '';

  /**
   * Hide the people who are in credit rather than in debt.
   *
   * ⚠ This is the `minOutstanding` absent-versus-zero distinction, and the two are not
   * the same request: absent keeps `balance <> 0` and so keeps the people carrying an
   * advance, while zero reads as `balance <= 0` and drops them
   * (`CreditBookRepository.java:88-94`). Off by default, because a panel called "who owes
   * us" that silently omitted two real customers would be the §7.1(b) mistake from the
   * other side.
   */
  owingOnly = false;

  query = '';
  searching = false;
  /** Null while browsing; a list (possibly empty) once a search has run. */
  searchResults: BookRow[] | null = null;

  // -- the tab beside the list ---------------------------------------------

  selectedId: number | null = null;
  statement: CreditStatementResponse | null = null;
  statementLoading = false;
  statementError = '';
  statementPage = 0;

  private readonly searchProbe = new Subject<string>();
  private readonly subscriptions = new Subscription();

  constructor(private api: RechargeApiService) {}

  ngOnInit(): void {
    this.load();
    this.subscriptions.add(
      this.searchProbe
        .pipe(
          debounceTime(250),
          distinctUntilChanged(),
          switchMap((value) => {
            this.searching = true;
            return this.api.searchCustomers(value, 25).pipe(catchError(() => of([])));
          })
        )
        .subscribe((found) => {
          this.searching = false;
          this.searchResults = found.map((row) => this.fromSearch(row));
        })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.subscriptions.add(
      // ⚠ `undefined` and `0` are different requests here. See `owingOnly`.
      this.api.creditBook(this.owingOnly ? 0 : undefined, 0, BOOK_PAGE_SIZE).subscribe({
        next: (page) => {
          this.loading = false;
          this.rows = page.content.map((row) => this.fromBook(row));
          this.peopleOnBook = page.totalElements;
        },
        error: (error) => {
          this.loading = false;
          this.loadError = errorSentence(error);
        }
      })
    );
  }

  toggleOwingOnly(): void {
    this.owingOnly = !this.owingOnly;
    this.load();
  }

  // -- searching ------------------------------------------------------------

  onQuery(value: string): void {
    this.query = value;
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
      this.searchProbe.next(trimmed);
    } else {
      // Back to browsing, rather than showing a stale result set under a cleared box.
      this.searchResults = null;
      this.searching = false;
    }
  }

  clearQuery(): void {
    this.query = '';
    this.searchResults = null;
    this.searching = false;
  }

  /** What the list is showing: the search result when there is one, else the book. */
  get visibleRows(): BookRow[] {
    return this.searchResults ?? this.rows;
  }

  get searchingNow(): boolean {
    return this.searchResults !== null || this.query.trim().length >= 2;
  }

  // -- the figures across the top -------------------------------------------

  /**
   * What is owed across the rows that are loaded.
   *
   * ⚠ Summed from the loaded page, so it is only the WHOLE book when the whole book is
   * loaded — there is no endpoint that returns the total. `wholeBookLoaded` is what the
   * template uses to decide whether to call this a total or "across the N shown", because
   * a figure captioned as the total while being a page of it is the kind of authoritative
   * wrong number §14.8 is about.
   */
  get totalOwed(): number {
    const paise = this.rows.reduce((sum, row) => sum + Math.round(row.outstanding * 100), 0);
    return paise / 100;
  }

  get totalAdvance(): number {
    const paise = this.rows.reduce((sum, row) => sum + Math.round(row.advanceHeld * 100), 0);
    return paise / 100;
  }

  get wholeBookLoaded(): boolean {
    return this.rows.length >= this.peopleOnBook;
  }

  get owingCount(): number {
    return this.rows.filter((row) => row.outstanding > 0).length;
  }

  get overdueCount(): number {
    return this.rows.filter((row) => row.warn).length;
  }

  get inCreditCount(): number {
    return this.rows.filter((row) => row.advanceHeld > 0).length;
  }

  // -- one person's tab -----------------------------------------------------

  select(row: BookRow): void {
    this.selectedId = row.customerId;
    this.statementPage = 0;
    this.loadStatement();
  }

  closeStatement(): void {
    this.selectedId = null;
    this.statement = null;
    this.statementError = '';
  }

  statementGoToPage(page: number): void {
    this.statementPage = page;
    this.loadStatement();
  }

  private loadStatement(): void {
    if (this.selectedId === null) {
      return;
    }
    this.statementLoading = true;
    this.statementError = '';
    this.subscriptions.add(
      this.api.creditStatement(this.selectedId, this.statementPage).subscribe({
        next: (statement) => {
          this.statementLoading = false;
          this.statement = statement;
        },
        error: (error) => {
          this.statementLoading = false;
          this.statement = null;
          // A 404 here is the §2.6 case: an unknown customer or a bank pseudo-customer,
          // which is refused rather than answered with an empty tab that reads as
          // "owes nothing".
          this.statementError = errorSentence(error);
        }
      })
    );
  }

  get statementLines(): StatementLineResponse[] {
    return this.statement?.lines.content ?? [];
  }

  get statementTotalPages(): number {
    return this.statement?.lines.totalPages ?? 0;
  }

  // -- wording --------------------------------------------------------------

  /**
   * The one netted position as a sentence.
   *
   * Never two figures: `outstanding` and `advanceHeld` cannot both be non-zero, so showing
   * both columns would always show one zero and invite reading it as a second balance.
   */
  positionWord(row: BookRow | CreditStatementResponse): string {
    if (row.outstanding > 0) {
      return `owes ₹${row.outstanding.toFixed(2)}`;
    }
    if (row.advanceHeld > 0) {
      return `has ₹${row.advanceHeld.toFixed(2)} with us`;
    }
    return 'settled up';
  }

  /**
   * How a statement line reads.
   *
   * ⚠ `type` is a legacy COLUMN CODE, not prose: `ref_credit_req_type` holds `DBT` and
   * `DPAM` (V9:164-169), and the shop's own records have used those two for years. Shown
   * raw it reads as "DBT" on a screen a staff member uses to tell a customer what they
   * owe, so the two known codes are worded and anything else is shown as it arrives
   * rather than guessed at.
   */
  lineWord(line: StatementLineResponse): string {
    switch (line.type) {
      case 'DBT':
        return 'Credit taken';
      case 'DPAM':
        return 'Payment received';
      default:
        return line.type;
    }
  }

  /**
   * The line's amount as a magnitude.
   *
   * ⚠ `amount` ARRIVES SIGNED — `DBT` rows are stored negative and `DPAM` positive
   * (`RcCreditReq.java:17`), which is the legacy convention and not a display decision.
   * Printed raw it reads "₹-299.00" against a line already labelled "Credit taken", which
   * says the direction twice and contradicts itself to anyone reading the minus as a
   * credit. The word carries the direction; the figure carries the size.
   */
  lineAmount(line: StatementLineResponse): number {
    return Math.abs(line.amount);
  }

  /** `runningBalance` is signed: negative is owed, which is the ledger's sign, not ours. */
  balanceWord(runningBalance: number): string {
    const magnitude = Math.abs(runningBalance).toFixed(2);
    if (Math.round(runningBalance * 100) === 0) {
      return 'clear';
    }
    return runningBalance < 0 ? `₹${magnitude} owed` : `₹${magnitude} in hand`;
  }

  trackByCustomer(_index: number, row: BookRow): number {
    return row.customerId;
  }

  trackByLine(_index: number, line: StatementLineResponse): number {
    return line.creditRequestId;
  }

  private fromBook(row: CreditBookRowResponse): BookRow {
    return { ...row, lastActivityAt: row.lastActivityAt };
  }

  private fromSearch(row: CreditCustomerResponse): BookRow {
    return { ...row, lastActivityAt: null };
  }
}
