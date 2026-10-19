import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { environment } from '../../../../environments/environment';
import { SectionChromeModule } from '../../shared/section-chrome.module';
import {
  CreditBookRowResponse,
  CreditStatementResponse,
  PageResponse,
  StatementLineResponse
} from '../../recharge/model/recharge.models';
import { CreditBookComponent } from './credit-book.component';

function row(overrides: Partial<CreditBookRowResponse> = {}): CreditBookRowResponse {
  return {
    customerId: 4821,
    name: 'Sunil Patil',
    contactNumber: '9823011111',
    outstanding: 2049,
    advanceHeld: 0,
    oldestDebtDays: 41,
    warn: true,
    lastActivityAt: '2026-09-07T11:20:00',
    ...overrides
  };
}

function bookPage(content: CreditBookRowResponse[], totalElements = content.length):
  PageResponse<CreditBookRowResponse> {
  return { content, page: 0, size: 100, totalElements, totalPages: 1 };
}

function statementLine(overrides: Partial<StatementLineResponse> = {}): StatementLineResponse {
  return {
    creditRequestId: 551,
    at: '2026-09-07T11:20:00',
    // ⚠ The REAL wire shape, read off a running backend: `type` is the legacy column code
    // from `ref_credit_req_type` (V9:164-169), not prose, and `amount` arrives SIGNED with
    // DBT negative (`RcCreditReq.java:17`).
    type: 'DBT',
    amount: -299,
    // ⚠ The one SIGNED figure in this API: negative is owed.
    runningBalance: -2049,
    note: null,
    extendedBy: null,
    paymentId: 5,
    ...overrides
  };
}

function statement(overrides: Partial<CreditStatementResponse> = {}): CreditStatementResponse {
  return {
    customerId: 4821,
    name: 'Sunil Patil',
    contactNumber: '9823011111',
    outstanding: 2049,
    advanceHeld: 0,
    oldestDebtDays: 41,
    warn: true,
    lines: {
      content: [statementLine()],
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1
    },
    ...overrides
  };
}

describe('CreditBookComponent', () => {
  let fixture: ComponentFixture<CreditBookComponent>;
  let book: CreditBookComponent;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/recharge`;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule, RouterTestingModule, SectionChromeModule],
      declarations: [CreditBookComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(CreditBookComponent);
    book = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.match(() => true);
    http.verify();
  });

  function load(rows: CreditBookRowResponse[], totalElements = rows.length): void {
    http.expectOne((r) => r.url === `${base}/credit/customers`)
      .flush(bookPage(rows, totalElements));
    fixture.detectChanges();
  }

  // ------------------------------------------------- what it asks for

  /**
   * ⚠ ABSENT, NOT ZERO. Absent keeps `balance <> 0` and so keeps the people carrying an
   * advance; zero reads as `balance <= 0` and drops them
   * (`CreditBookRepository.java:88-94`). A panel called "who owes us" that silently
   * omitted two real customers would be the §7.1(b) mistake from the other side.
   */
  it('asks for everyone with a tab, not everyone who owes', () => {
    const request = http.expectOne((r) => r.url === `${base}/credit/customers`);
    expect(request.request.params.has('minOutstanding')).toBe(false);
    request.flush(bookPage([row()]));
  });

  it('sends a zero only when the staff member asks to hide people in credit', () => {
    load([row()]);
    book.toggleOwingOnly();

    const request = http.expectOne((r) => r.url === `${base}/credit/customers`);
    expect(request.request.params.get('minOutstanding')).toBe('0');
    request.flush(bookPage([row()]));
  });

  // ------------------------------------------------- the netted position

  /**
   * ⚠ ONE netted position per person, never an owes column beside a holds column.
   * `outstanding` and `advanceHeld` are both positive and only one is ever non-zero, so
   * showing both would always show a zero and invite reading it as a second balance.
   */
  it('words the position instead of showing two figures', () => {
    load([
      row(),
      row({ customerId: 4822, name: 'Asha Kale', outstanding: 0, advanceHeld: 80,
            oldestDebtDays: null, warn: false })
    ]);

    expect(book.positionWord(book.rows[0])).toBe('owes ₹2049.00');
    expect(book.positionWord(book.rows[1])).toBe('has ₹80.00 with us');

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('owes ₹2049.00');
    expect(text).toContain('has ₹80.00 with us');
  });

  it('calls a cleared tab settled up rather than owing nothing', () => {
    load([row({ outstanding: 0, advanceHeld: 0, oldestDebtDays: null, warn: false })]);
    expect(book.positionWord(book.rows[0])).toBe('settled up');
  });

  // ------------------------------------------------- the figures on top

  /**
   * ⚠ There is no endpoint that returns the book's total, so the figure is summed from the
   * loaded rows — and it is captioned as a total ONLY when the whole book is loaded.
   * Captioning a page of it as the total is the authoritative-wrong-number mistake §14.8
   * is about.
   */
  it('calls the sum a total only when the whole book is loaded', () => {
    load([row(), row({ customerId: 4822, outstanding: 151, warn: false, oldestDebtDays: 3 })]);

    expect(book.wholeBookLoaded).toBe(true);
    expect(book.totalOwed).toBe(2200);
    expect(fixture.nativeElement.textContent as string).toContain('Owed to us');
  });

  it('says so when it is holding only part of the book', () => {
    load([row()], 140);

    expect(book.wholeBookLoaded).toBe(false);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Owed across the 1 shown');
    expect(text).toContain('not the whole book');
  });

  /** ⚠ Server-computed. The 30-day rule is never re-derived on a client. */
  it('counts the overdue from the server’s flag, not from the day count', () => {
    load([
      row({ warn: true, oldestDebtDays: 41 }),
      // 29 days and not flagged: the client must not second-guess either way.
      row({ customerId: 4822, warn: false, oldestDebtDays: 29 })
    ]);

    expect(book.overdueCount).toBe(1);
  });

  it('shows what is held for customers separately from what is owed', () => {
    load([
      row(),
      row({ customerId: 4822, outstanding: 0, advanceHeld: 80, oldestDebtDays: null, warn: false })
    ]);

    expect(book.totalOwed).toBe(2049);
    expect(book.totalAdvance).toBe(80);
    expect(book.inCreditCount).toBe(1);
    expect(fixture.nativeElement.textContent as string).toContain('not debt');
  });

  // ------------------------------------------------- searching

  /**
   * ⚠ The search is a DIFFERENT endpoint, because #14 has no query parameter. #4 matches
   * on name or mobile across every customer, which is why it can return someone settled
   * up — said on the screen rather than hidden.
   */
  it('searches with the customer endpoint, not by filtering the book', fakeAsync(() => {
    load([row()]);

    book.onQuery('asha');
    tick(250);

    const request = http.expectOne((r) => r.url === `${base}/customers`);
    expect(request.request.params.get('query')).toBe('asha');
    request.flush([{
      customerId: 4822, name: 'Asha Kale', contactNumber: '9823022222',
      outstanding: 0, advanceHeld: 0, oldestDebtDays: null, warn: false
    }]);
    fixture.detectChanges();

    expect(book.visibleRows.length).toBe(1);
    expect(book.visibleRows[0].name).toBe('Asha Kale');
    // ⚠ No `lastActivityAt` on a search result, so the column is empty rather than faked.
    expect(book.visibleRows[0].lastActivityAt).toBeNull();
    expect(fixture.nativeElement.textContent as string).toContain('About this search');
  }));

  it('goes back to the book when the box is cleared', fakeAsync(() => {
    load([row()]);

    book.onQuery('asha');
    tick(250);
    http.expectOne((r) => r.url === `${base}/customers`).flush([]);
    fixture.detectChanges();
    expect(book.visibleRows.length).toBe(0);

    book.clearQuery();
    fixture.detectChanges();
    expect(book.visibleRows.length).toBe(1);
    expect(book.visibleRows[0].name).toBe('Sunil Patil');
  }));

  it('does not search on one character', fakeAsync(() => {
    load([row()]);
    book.onQuery('a');
    tick(250);
    // No request at all, and the book is still what is showing.
    expect(book.searchResults).toBeNull();
  }));

  // ------------------------------------------------- one person's tab

  it('reads one person’s tab when their row is picked', () => {
    load([row()]);
    book.select(book.rows[0]);

    const request = http.expectOne((r) => r.url === `${base}/credit/customers/4821`);
    request.flush(statement());
    fixture.detectChanges();

    expect(book.statement?.name).toBe('Sunil Patil');
    expect(book.statementLines.length).toBe(1);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Oldest unpaid for 41 days');
  });

  /** `runningBalance` is the one signed figure, and negative means owed. */
  it('reads the signed running balance the right way round', () => {
    load([row()]);
    expect(book.balanceWord(-2049)).toBe('₹2049.00 owed');
    expect(book.balanceWord(80)).toBe('₹80.00 in hand');
    expect(book.balanceWord(0)).toBe('clear');
  });

  /**
   * ⚠ `type` is the legacy COLUMN CODE, not prose. Shown raw it reads "DBT" on the screen
   * a staff member uses to tell a customer what they owe. Caught by running it.
   */
  it('words the legacy type codes instead of printing them', () => {
    load([row()]);
    expect(book.lineWord(statementLine({ type: 'DBT' }))).toBe('Credit taken');
    expect(book.lineWord(statementLine({ type: 'DPAM' }))).toBe('Payment received');
    // An unknown code is shown as it arrives rather than guessed at.
    expect(book.lineWord(statementLine({ type: 'XYZ' }))).toBe('XYZ');
  });

  /**
   * ⚠ `amount` arrives SIGNED (DBT negative). Printed raw it read "₹-299.00" under a line
   * already labelled "Credit taken" — the direction said twice, and contradicted for
   * anyone who reads a minus as money coming back. Caught by running it.
   */
  it('shows the line amount as a magnitude, with the word carrying the direction', () => {
    load([row()]);
    book.select(book.rows[0]);
    http.expectOne((r) => r.url === `${base}/credit/customers/4821`).flush(statement());
    fixture.detectChanges();

    expect(book.lineAmount(statementLine())).toBe(299);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('₹299.00');
    expect(text).not.toContain('₹-299.00');
    expect(text).toContain('Credit taken');
  });

  /**
   * ⚠ A `KEEP_AS_ADVANCE` refund posts to the LEDGER (`ADV_RECHARGE`), not to
   * `rc_credit_req` — so the money never reaches this book, and a customer told "₹250 kept
   * on your account" shows here as holding nothing. Observed against a running backend.
   * Said on the screen rather than netted in on the client, which would be a second
   * formula for a number the server owns.
   */
  it('says plainly that an advance kept from a refund is not on this book', () => {
    load([row()]);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('One thing this book does not see');
    expect(text).toContain('the ledger is the one that is right');
  });

  /**
   * ⚠ `extendedBy` is null on every historical row, and §8.8 found that no record of who
   * extended a legacy credit exists anywhere. So its absence is ORDINARY and must not be
   * rendered as missing data.
   */
  it('shows no slot for who extended a legacy credit', () => {
    load([row()]);
    book.select(book.rows[0]);
    http.expectOne((r) => r.url === `${base}/credit/customers/4821`).flush(statement());
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.line-by')).toBeNull();
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('unknown');
  });

  it('names who extended it when the record does have one', () => {
    load([row()]);
    book.select(book.rows[0]);
    http.expectOne((r) => r.url === `${base}/credit/customers/4821`).flush(
      statement({
        lines: {
          content: [statementLine({ extendedBy: 'Jaydeep' })],
          page: 0, size: 50, totalElements: 1, totalPages: 1
        }
      })
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.line-by').textContent).toContain('Jaydeep');
  });

  /**
   * A 404 is the §2.6 case — an unknown customer or a bank pseudo-customer — and it is
   * refused rather than answered with an empty tab, because an empty tab reads as "owes
   * nothing".
   */
  it('shows the refusal rather than an empty tab', () => {
    load([row()]);
    book.select(book.rows[0]);
    http.expectOne((r) => r.url === `${base}/credit/customers/4821`).flush(
      { code: 'CUSTOMER_NOT_FOUND', message: 'No customer 4821.' },
      { status: 404, statusText: 'Not Found' }
    );
    fixture.detectChanges();

    expect(book.statement).toBeNull();
    expect(book.statementError).toContain('no longer exists');
  });

  // ------------------------------------------------- what is not here

  /**
   * ⚠ #16 is deferred to S6 for a correctness reason, not a scheduling one: a receipt has
   * to clear `AR_*` legs oldest-first and each names its own business, and the legacy
   * balances are not in the ledger until V30/V31. Named on the screen so the gap is not
   * read as an oversight.
   */
  it('names taking a payment as not built, and why', () => {
    load([row()]);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Taking a payment is not here yet');
    expect(text).toContain('oldest debt first');
    expect(fixture.nativeElement.querySelector('[data-take-payment]')).toBeNull();
  });

  /** The cross-business rule is the whole reason the panel exists; it says so. */
  it('says the figures cross every business and ignore the year', () => {
    load([row()]);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Across every business');
    expect(text).toContain('never filtered by year');
  });

  it('says the book is clear rather than showing an empty table', () => {
    load([]);
    expect(fixture.nativeElement.querySelector('.table')).toBeNull();
    expect(fixture.nativeElement.textContent as string).toContain('The book is clear');
  });
});
