import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../../environments/environment';
import { SectionChromeModule } from '../../shared/section-chrome.module';
import { DaySummaryResponse } from '../../recharge/model/recharge.models';
import { DaySummaryComponent } from './day-summary.component';

function summary(overrides: Partial<DaySummaryResponse> = {}): DaySummaryResponse {
  return {
    date: '2026-10-13',
    takings: [
      { operatorCode: 'JIO', routeCode: 'DIRECT', count: 7, amount: 2093, surcharge: 0 },
      { operatorCode: 'DISHTV', routeCode: 'A1TOPUP', count: 4, amount: 1429, surcharge: 40 }
    ],
    totalTakings: 3522,
    totalSurcharge: 40,
    // 3522 + 40: the day's recognised income, NOT the till figure.
    totalCollected: 3562,
    // ⚠ The till figure, and it must equal tenderMix.CASH — two independent
    // readings. A fixture where they differ is a fixture asserting a bug.
    //
    // Note what it is NOT: it is not collected (3562) and not collected + held
    // (4309). Cash of 3104 was taken today; the rest of the recognised income
    // arrived by UPI, and the held money is from earlier days. Both superseded
    // formulas are wrong against this fixture, which is the point — the previous
    // version made them both look right.
    cashCollectedToday: 3104,
    // ⚠ The third term, and zero here on purpose: this fixture is a day with no refund
    // in it, which was the shape of EVERY fixture when the two-term identity shipped and
    // is exactly why no test caught it. `tillSourcesAgree` is now
    // `cashCollectedToday === tenderMix.CASH − cashPaidOutToday`, and the refund day is
    // covered by its own case below.
    cashPaidOutToday: 0,
    tenderMix: { CASH: 3104, UPI: 418 },
    awaitingCount: 1,
    unresolvedFailureCount: 1,
    heldPending: 747,
    ...overrides
  };
}

describe('DaySummaryComponent', () => {
  let fixture: ComponentFixture<DaySummaryComponent>;
  let day: DaySummaryComponent;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/recharge`;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule, SectionChromeModule],
      declarations: [DaySummaryComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(DaySummaryComponent);
    day = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    // Drain anything still in flight (a background refresh, say) WITHOUT flushing a body
    // into it: match() removes the requests, so verify() is still meaningful about the
    // ones each test asserted on.
    http.match(() => true);
    http.verify();
  });

  function respond(response: DaySummaryResponse): void {
    http.expectOne((r) => r.url === `${base}/day-summary`).flush(response);
    fixture.detectChanges();
  }

  /** The till figure is READ from the ledger, not computed from other fields. */
  it('shows the ledger cash movement as what the books say the till holds', () => {
    respond(summary());
    expect(day.booksExpect).toBe(3104);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('The books say the recharge till took in');
    expect(text).toContain('3,104.00');
  });

  /**
   * ⚠ The label follows the figure, because the figure is a NET movement now.
   *
   * A day with no cash sales that refunds an earlier day's failure moves cash OUT, and the
   * lead figure is negative. "The books expect the till to hold ₹-350.00" is not a
   * statement anyone can act on. `tillSourcesAgree` is correctly quiet here — the day is
   * not wrong, it is just not a holding.
   */
  it('changes the label on a day that only paid cash out', () => {
    respond(summary({
      cashCollectedToday: -350,
      cashPaidOutToday: 350,
      tenderMix: {},
      takings: [],
      totalTakings: 0,
      totalSurcharge: 0,
      totalCollected: 0
    }));

    expect(day.tillSourcesAgree).toBe(true);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('cash moved OUT today');
    expect(text).not.toContain('expect the till to hold');
  });

  /**
   * ⚠ BOTH FORMULAS THIS SCREEN GOT WRONG, pinned as inequalities so neither returns.
   *
   *   1. `totalTakings + heldPending` shipped in the first version and omitted our own
   *      charge — ₹10 short per DTH recharge.
   *   2. `totalCollected + heldPending` replaced it and was still wrong: `heldPending` has
   *      no date filter and counts UPI and credit settlements that never reached the till.
   *
   * Both were only ever checked against same-day all-cash fixtures, where they balance.
   */
  it('uses neither superseded formula', () => {
    respond(summary());
    expect(day.booksExpect).not.toBe(3522 + 747);
    expect(day.booksExpect).not.toBe(3562 + 747);
  });

  /**
   * The cross-check that replaces the identity: the ledger's cash movement and the sum of
   * today's cash tender rows come from different tables and must agree.
   */
  it('agrees with the cash tender rows, which is the real check', () => {
    respond(summary());
    expect(day.tillSourcesAgree).toBe(true);
    expect(day.booksExpect).toBe(day.summary!.tenderMix.CASH!);
  });

  /** ⚠ And when they disagree, it says a POSTING is wrong rather than a count. */
  it('warns loudly when the ledger and the tender rows disagree', () => {
    respond(summary({ cashCollectedToday: 3104, tenderMix: { CASH: 3000, UPI: 418 } }));
    expect(day.tillSourcesAgree).toBe(false);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('a posting is wrong');
  });

  /**
   * ⚠ THE CASE NO FIXTURE HAD, and the reason the two-term identity survived a review and
   * a test suite: every fixture was a day with no refund in it.
   *
   * `ck_txnpay_amount CHECK (AMOUNT > 0)` makes a negative tender line unrepresentable, so
   * a refund moves the ledger figure and leaves the tender figure alone. The real numbers
   * that found it were 849 against 1199 — a ₹350 refund on a ₹1,199 cash day.
   */
  it('calls a refund day correct, which it did not before', () => {
    respond(summary({
      cashCollectedToday: 849,
      cashPaidOutToday: 350,
      tenderMix: { CASH: 1199 }
    }));

    expect(day.tillSourcesAgree).toBe(true);
    expect(day.booksExpect).toBe(849);
  });

  /** On that day the drawer holds less than was taken, and the screen has to say why. */
  it('shows what was handed back rather than only subtracting it', () => {
    respond(summary({
      cashCollectedToday: 849,
      cashPaidOutToday: 350,
      tenderMix: { CASH: 1199 }
    }));

    expect(day.hasPaidOut).toBe(true);
    expect(day.paidOut).toBe(350);
    expect(day.cashTakenGross).toBe(1199);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('350.00');
    expect(text).toContain('handed back');
  });

  /**
   * ⚠ The pay-out belongs on the TENDER side of the comparison, not the ledger side.
   * Subtracting it from both would make a refund day disagree by exactly the refund, which
   * is the same false alarm in a new place.
   */
  it('still catches a wrong posting on a day that also had a refund', () => {
    respond(summary({
      cashCollectedToday: 900,
      cashPaidOutToday: 350,
      tenderMix: { CASH: 1199 }
    }));

    expect(day.tillSourcesAgree).toBe(false);
  });

  /** Nothing went back out, so nothing is said about it. */
  it('says nothing about pay-outs on an ordinary day', () => {
    respond(summary());

    expect(day.hasPaidOut).toBe(false);
    expect(fixture.nativeElement.textContent as string).not.toContain('handed back');
  });

  /** A UPI-only day takes no cash, however much income it recognised. */
  it('reports a zero till on a day with no cash tender', () => {
    respond(
      summary({ cashCollectedToday: 0, tenderMix: { UPI: 418 }, heldPending: 747 })
    );
    expect(day.booksExpect).toBe(0);
    expect(day.tillSourcesAgree).toBe(true);
  });

  /**
   * ⚠ "held", never "till mismatch". `totalTakings` counts COMPLETED only, so the till
   * running above takings is correct whenever a recharge has failed and not been refunded
   * — the money is held, not missing.
   */
  it('words the gap as money held, and never as a mismatch', () => {
    respond(summary());
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('held against 1 unresolved recharge');
    expect(text).toContain('belongs to the customer');
    // The word "shortfall" may appear only to deny it, which is the point of the sentence.
    expect(text).toContain('not a shortfall');
    const lower = text.toLowerCase();
    expect(lower).not.toContain('mismatch');
    expect(lower).not.toContain('missing');
    expect(lower).not.toContain('till is short');
    expect(lower.split('shortfall').length - 1).toBe(1);
  });

  it('says plainly that nothing is held when nothing is', () => {
    respond(summary({ heldPending: 0, awaitingCount: 0, unresolvedFailureCount: 0 }));
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Nothing held');
    expect(text).toContain('should match takings exactly');
  });

  /** 60% of DTH margin, and the only check there is on the operator-paid rate. */
  it('reports our charges separately and never inside takings', () => {
    respond(summary());
    expect(day.summary!.totalSurcharge).toBe(40);
    expect(day.summary!.totalTakings).toBe(3522);
    expect(fixture.nativeElement.textContent).toContain('never folded into takings');
  });

  /** ⚠ Keys are absent when zero, so a missing CREDIT means none was taken. */
  it('leaves out a tender method the server did not report', () => {
    respond(summary());
    expect(day.tenderMix.map((entry) => entry.method)).toEqual(['CASH', 'UPI']);
  });

  it('flags how much of the takings never reached the drawer', () => {
    respond(summary());
    expect(day.nonCashTaken).toBe(418);
    expect(fixture.nativeElement.textContent).toContain('never reached');
  });

  it('counts nothing as non-cash when everything was cash', () => {
    respond(summary({ tenderMix: { CASH: 3522 } }));
    expect(day.nonCashTaken).toBe(0);
    expect(fixture.nativeElement.textContent).not.toContain('never reached');
  });

  it('breaks takings down by operator and route so a gap is attributable', () => {
    respond(summary());
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('JIO');
    expect(rows[0].textContent).toContain('DIRECT');
  });

  it('says what the rest of the close screen still needs', () => {
    respond(summary());
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Not here yet');
    expect(text).toContain('nothing on this screen seals anything');
  });

  it('handles a day with no completed recharges', () => {
    respond(summary({ takings: [], totalTakings: 0, totalSurcharge: 0, totalCollected: 0, cashCollectedToday: 0, tenderMix: {} }));
    expect(fixture.nativeElement.textContent).toContain('No completed recharges on this day');
  });
});
