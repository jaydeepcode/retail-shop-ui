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
 * ⚠ THE ONE GAP THIS SCREEN USED TO CARRY IS CLOSED, and how it closed is worth keeping.
 * An advance kept from a refund did not appear here: `KEEP_AS_ADVANCE` posted a ledger leg
 * to `ADV_RECHARGE` with the customer as party, while this book and the statement read
 * `rc_credit_req`, which that path never wrote. So the failure screen could tell a customer
 * "₹250 kept on your account" and this screen — the one whose whole job is each person's
 * position — showed them holding nothing. Observed against a running backend on 2026-10-19:
 * Asha Kale, ₹250 kept, `advanceHeld` 0.00, an empty statement.
 *
 * ⚠ It was NOT worked around here, and that is why it was fixed properly. Netting a ledger
 * balance into these figures on the client would have been a second formula for a number
 * the server owns — the one thing every screen in this slice is built not to do — and it
 * would have disagreed with the counter's credit panel, which reads the same `positionOf`.
 * It was reported instead, and the backend withdrew `KEEP_AS_ADVANCE` on 2026-10-21 (log
 * §16.2): nothing debits `ADV_RECHARGE`, so the mode changed the liability's shape rather
 * than ending it. `ResidualMode.UPI` took its place. **Nothing writes `ADV_RECHARGE` any
 * more, so these figures are complete**, and the on-screen note that described the gap
 * came out with it.
 *
 * ⚠ AN "ADD ADVANCE" CONTROL IS STILL NOT HERE, and was considered and dropped. log §2.8
 * requires a receipt to settle outstanding debt first and only then hold a remainder, and
 * the settle half cannot be built until V30/V31 puts legacy debt in the ledger. A version
 * restricted to customers who owe nothing would be disabled for almost every row on a
 * screen that exists to list people who owe.
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

  /** Carries the query, and `''` for "stopped searching" — see `ngOnInit`. */
  private readonly searchProbe = new Subject<string>();
  /** Carries the customer whose tab to read. */
  private readonly statementProbe = new Subject<number>();
  private readonly subscriptions = new Subscription();

  constructor(private api: RechargeApiService) {}

  ngOnInit(): void {
    this.load();

    /**
     * ⚠ THE EMPTY STRING IS AN EVENT, not the absence of one, and `distinctUntilChanged`
     * comes BEFORE the debounce. Both matter, and neither is a style choice:
     *
     *   - Clearing the box used to drop out of this pipe entirely, so a request already in
     *     flight still landed and put the search rows back under an empty input.
     *     `switchMap` can only tear that request down if the clear reaches it.
     *   - `distinctUntilChanged` compares against the last value it LET THROUGH, so after
     *     the debounce it still held "asha" once the box was cleared. Searching the same
     *     name again was then dropped as a duplicate: no request, no rows, and the screen
     *     left showing the whole book under a caption claiming it matched a search.
     *     Before the debounce, the `''` resets it.
     */
    this.subscriptions.add(
      this.searchProbe
        .pipe(
          distinctUntilChanged(),
          debounceTime(250),
          switchMap((value) => {
            if (value.length < 2) {
              this.searching = false;
              return of(null);
            }
            this.searching = true;
            return this.api.searchCustomers(value, 25).pipe(catchError(() => of([])));
          })
        )
        .subscribe((found) => {
          this.searching = false;
          this.searchResults = found === null ? null : found.map((row) => this.fromSearch(row));
        })
    );

    /**
     * ⚠ `switchMap`, so clicking a second person cancels the first read.
     *
     * Two overlapping reads used to settle in whatever order they arrived: click Sunil
     * then Asha, and Sunil's response landing second left his tab on screen under Asha's
     * highlighted row. The error path was worse — it nulls the statement, so a late 404
     * for a customer with no credit record wiped out a tab that had just loaded correctly
     * for someone else.
     */
    this.subscriptions.add(
      this.statementProbe
        .pipe(
          switchMap((customerId) => {
            this.statementLoading = true;
            this.statementError = '';
            return this.api.creditStatement(customerId, this.statementPage).pipe(
              catchError((error) => {
                // A 404 is the §2.6 case: an unknown customer or a bank pseudo-customer,
                // refused rather than answered with an empty tab that reads as "owes
                // nothing".
                this.statementError = errorSentence(error);
                return of(null);
              })
            );
          })
        )
        .subscribe((statement) => {
          this.statementLoading = false;
          this.statement = statement;
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
    // ⚠ Always pushed, including the short/empty case. The pipe turns that back into
    // "browsing" AND cancels whatever is in flight; handling it here could not.
    this.searchProbe.next(value.trim());
  }

  clearQuery(): void {
    this.query = '';
    this.searchProbe.next('');
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

  /**
   * Whether the loaded rows ARE the book, so the figures above can speak for all of it.
   *
   * ⚠ False until the first page lands. `0 >= 0` is true on an empty component, which is
   * what used to put the unqualified caption "Owed to us" over "₹0.00" on first paint —
   * the authoritative-wrong-number failure this flag exists to prevent, shown with full
   * confidence while the request was still out. The template also gates on `loading`; this
   * guard is the one that survives a reader who forgets to.
   */
  get wholeBookLoaded(): boolean {
    return !this.loading && !!this.rows.length && this.rows.length >= this.peopleOnBook;
  }

  /**
   * ⚠ ALL THREE COUNT THE LOADED ROWS, not the book.
   *
   * With more people than `BOOK_PAGE_SIZE`, a numerator from one page beside the
   * book-wide `peopleOnBook` reads "72 of 150" and understates how many customers are
   * overdue on the one panel that exists to make debt chaseable. `wholeBookLoaded` is
   * what the template uses to caption them honestly — the same guard `totalOwed` carries.
   */
  get owingCount(): number {
    return this.rows.filter((row) => row.outstanding > 0).length;
  }

  get overdueCount(): number {
    return this.rows.filter((row) => row.warn).length;
  }

  get inCreditCount(): number {
    return this.rows.filter((row) => row.advanceHeld > 0).length;
  }

  /**
   * What `peopleOnBook` is actually counting, which the toggle changes.
   *
   * ⚠ It is the FILTERED total. With `owingOnly` on, `minOutstanding=0` drops everyone
   * carrying an advance, so the one number on this screen that is supposed to mean
   * "everyone with a tab" quietly starts meaning "everyone who owes". Said rather than
   * left for a reader to discover.
   */
  get peopleWord(): string {
    return this.owingOnly ? 'who owe' : 'with a tab';
  }

  // -- one person's tab -----------------------------------------------------

  select(row: BookRow): void {
    this.selectedId = row.customerId;
    this.statementPage = 0;
    // ⚠ Cleared before the read, not after it. Left in place, the previous person's
    // balance sits under the new person's name for as long as the request takes — which
    // on this screen is someone else's debt shown against their name.
    this.statement = null;
    this.statementError = '';
    this.statementProbe.next(row.customerId);
  }

  closeStatement(): void {
    this.selectedId = null;
    this.statement = null;
    this.statementError = '';
    this.statementLoading = false;
  }

  statementGoToPage(page: number): void {
    if (this.selectedId === null) {
      return;
    }
    this.statementPage = page;
    this.statementProbe.next(this.selectedId);
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
