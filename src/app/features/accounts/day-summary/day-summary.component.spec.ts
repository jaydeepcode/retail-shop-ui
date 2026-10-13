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

  /** The identity the backend asserts and the gate compares against the drawer. */
  it('shows takings plus held as what the books expect the till to hold', () => {
    respond(summary());
    expect(day.booksExpect).toBe(4269);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('The books expect the till to hold');
    expect(text).toContain('4,269.00');
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
    respond(summary({ takings: [], totalTakings: 0, totalSurcharge: 0, tenderMix: {} }));
    expect(fixture.nativeElement.textContent).toContain('No completed recharges on this day');
  });
});
