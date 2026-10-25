import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { environment } from '../../../../environments/environment';
import { SectionChromeModule } from '../../shared/section-chrome.module';
import { BookingResponse, TicketDaySummaryResponse } from '../model/ticket.models';
import { TodayComponent } from './today.component';

const SUMMARY: TicketDaySummaryResponse = {
  date: '2026-10-25',
  bookings: 2,
  passengers: 3,
  fareTotal: 425,
  commissionTotal: 180,
  collectedTotal: 605,
  byFundingAccount: [{ accountCode: 'BANK_SELF', bookings: 1, fareTotal: 425 }]
};

const ROWS: BookingResponse[] = [
  {
    bookingId: 2, bookingDttm: '2026-10-25T12:00:00', bookingMode: 'BUS', passengerCount: 2,
    fareAmount: null, commissionAmount: 120, fundingAccountCode: null, shopFunded: false,
    totalDue: 120, customerId: null, note: null, settlementLines: [], voucherId: 2
  },
  {
    bookingId: 1, bookingDttm: '2026-10-25T11:30:00', bookingMode: 'RAIL', passengerCount: 1,
    fareAmount: 425, commissionAmount: 60, fundingAccountCode: 'BANK_SELF', shopFunded: true,
    totalDue: 485, customerId: null, note: 'Pune-Nagpur', settlementLines: [], voucherId: 1
  }
];

/**
 * Today is a TALLY, not a queue. These assertions are mostly about what it says in
 * words, because that is where the distinction lives: the same figures presented as
 * work outstanding would be read as work outstanding.
 */
describe('TodayComponent', () => {
  let fixture: ComponentFixture<TodayComponent>;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/tickets`;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, RouterTestingModule, SectionChromeModule],
      declarations: [TodayComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(TodayComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne(`${base}/day-summary`).flush(SUMMARY);
    http.expectOne((r) => r.url === `${base}/bookings`)
      .flush({ content: ROWS, totalElements: 2, totalPages: 1, number: 0, size: 50 });
    fixture.detectChanges();
  });

  afterEach(() => {
    http.match(() => true);
    http.verify();
  });

  it('⚠ tells what was EARNED apart from what was merely collected', () => {
    // ₹605 passed through the counter; ₹180 of it is the shop's. Presenting only the
    // first would make ticketing look four times the business it is.
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('We earned');
    expect(text).toContain('₹180.00');
    expect(text).toContain('₹605.00');
  });

  it('⚠ breaks the fares down per funding account', () => {
    // Four banks fund these; "₹425 left the banks today" does not say whose to check.
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('My HDFC');
    expect(text).toContain('₹425.00');
  });

  it('calls a fare a pass-through, not a cost', () => {
    expect(fixture.nativeElement.textContent).toContain('pass-through');
  });

  it('names the shared drawer, because the evening count is one count', () => {
    // CASH_TICKET shares POOL-1 with CASH_RECHARGE: a cash difference has two
    // businesses in it, and whoever counts needs to know that before they start.
    expect(fixture.nativeElement.textContent).toContain('shares a drawer with recharge');
  });

  it('shows each booking with what it earned', () => {
    const rows = fixture.nativeElement.querySelectorAll('.booking-line');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Bus');
    expect(rows[0].textContent).toContain('customer paid directly');
    expect(rows[1].textContent).toContain('Railway');
    expect(rows[1].textContent).toContain('My HDFC');
    expect(rows[1].textContent).toContain('₹60.00 ours');
  });

  it('⚠ offers no edit and no delete, and says where a correction goes', () => {
    // FRD §8.3 owns corrections; a button here would need its own copy of that rule.
    expect(fixture.nativeElement.querySelectorAll('button').length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('cannot be edited here');
  });
});
