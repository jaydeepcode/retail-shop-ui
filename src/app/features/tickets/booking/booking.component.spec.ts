import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { environment } from '../../../../environments/environment';
import { PaymentModule } from '../../shared/payment/payment.module';
import { BookingResponse } from '../model/ticket.models';
import { BookingComponent } from './booking.component';

/**
 * Artboard 11's rules, the ones that are rules rather than layout.
 *
 * ⚠ The single most important assertion here is that "customer paid directly" and the
 * funding picker are ONE control. The design is explicit that a separate flow toggle must
 * not be added, because two fields that can contradict each other is one field too many —
 * and `ck_tkt_funding` would then refuse a booking the screen believed was fine.
 */
describe('BookingComponent', () => {
  let fixture: ComponentFixture<BookingComponent>;
  let booking: BookingComponent;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/tickets`;

  const RESPONSE: BookingResponse = {
    bookingId: 7,
    bookingDttm: '2026-10-25T11:30:00',
    bookingMode: 'RAIL',
    passengerCount: 1,
    fareAmount: 425,
    commissionAmount: 60,
    fundingAccountCode: 'BANK_SELF',
    shopFunded: true,
    totalDue: 485,
    customerId: null,
    note: null,
    settlementLines: [{
      method: 'CASH', amount: 485, amountTendered: 500, changeGiven: 15,
      changeDisplayed: true, reference: null, customerId: null, note: null
    }],
    voucherId: 9
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule, RouterTestingModule, PaymentModule],
      declarations: [BookingComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(BookingComponent);
    booking = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.match(() => true);
    http.verify();
  });

  // ---------------------------------------------------------- the flow control

  describe('⚠ who paid the platform IS the flow', () => {

    it('starts with neither chosen, so the booking cannot be taken', () => {
      // Not a default of "customer paid directly": that would silently book flow 2 for
      // a staff member who simply had not answered the question yet.
      expect(booking.shopFunded).toBe(false);
      expect(booking.customerPaidDirectly).toBe(false);
      expect(booking.canBook).toBe(false);
    });

    it('choosing an account shows the fare row', () => {
      booking.chooseFunding('BANK_SELF');
      fixture.detectChanges();
      expect(booking.shopFunded).toBe(true);
      expect(fixture.nativeElement.querySelector('#booking-fare')).toBeTruthy();
    });

    it('⚠ customer-paid REMOVES the fare row from the DOM, not just hides it', () => {
      booking.chooseFunding('BANK_SELF');
      fixture.detectChanges();
      booking.customerPaid();
      fixture.detectChanges();

      // Absent rather than disabled: a hidden field holding a fare would be sent, and
      // the server would refuse with TICKET_FUNDING_MISMATCH while the screen showed
      // no fare at all.
      expect(fixture.nativeElement.querySelector('#booking-fare')).toBeNull();
    });

    it('⚠ customer-paid CLEARS a fare that was already typed', () => {
      booking.chooseFunding('BANK_SELF');
      booking.fareText = '425';
      booking.customerPaid();

      expect(booking.fareText).toBe('');
      expect(booking.fundingAccountCode).toBeNull();
    });

    it('choosing an account after customer-paid turns customer-paid off', () => {
      booking.customerPaid();
      booking.chooseFunding('BANK_WIFE');

      // One control: the two cannot both be on, so they cannot disagree.
      expect(booking.customerPaidDirectly).toBe(false);
      expect(booking.fundingAccountCode).toBe('BANK_WIFE');
    });

    it('sends neither fareAmount nor fundingAccountCode on a flow-2 booking', () => {
      booking.customerPaid();
      booking.onPassengersChange('2');
      booking.tender.line('CASH')!.amountTendered = '120';
      booking.takeBooking();

      const sent = http.expectOne(`${base}/bookings`);
      expect('fareAmount' in sent.request.body).toBe(false);
      expect('fundingAccountCode' in sent.request.body).toBe(false);
      expect(sent.request.body.commissionAmount).toBe(120);
      sent.flush(RESPONSE);
    });
  });

  // ---------------------------------------------------------- commission

  describe('commission defaults to ₹60 a head and stays editable', () => {

    it('follows the passenger count until it is touched', () => {
      booking.onPassengersChange('3');
      expect(booking.commissionText).toBe('180');
    });

    it('⚠ stops following once the staff type their own figure', () => {
      // ₹60 is today's price, not a law: FY2026 holds ₹3,435 and ₹2,160 on single
      // bookings. One keystroke for the common case, no rule for the uncommon one.
      booking.onCommissionChange('75');
      booking.onPassengersChange('2');

      expect(booking.commissionText).toBe('75');
      expect(booking.commissionAmount).toBe(75);
    });

    it('a zero commission is allowed — 17 historical bookings earned nothing', () => {
      booking.chooseFunding('BANK_JANATA');
      booking.fareText = '425';
      booking.onCommissionChange('0');
      booking.tender.line('CASH')!.amountTendered = '425';

      expect(booking.totalDue).toBe(425);
      expect(booking.canBook).toBe(true);
    });
  });

  // ---------------------------------------------------------- the total

  describe('the total the tender has to match', () => {

    it('is fare plus commission, in paise so a float never drifts', () => {
      booking.chooseFunding('BANK_SELF');
      booking.fareText = '425.10';
      booking.onCommissionChange('60.20');
      expect(booking.totalDue).toBe(485.3);
    });

    it('is commission alone when the customer paid the platform', () => {
      booking.customerPaid();
      booking.onCommissionChange('60');
      expect(booking.totalDue).toBe(60);
    });

    it('⚠ the shared panel matches THIS screen total, not a recharge basket', () => {
      booking.chooseFunding('BANK_SELF');
      booking.fareText = '425';
      booking.onCommissionChange('60');
      fixture.detectChanges();

      // The panel reads the total through a supplier, so it is never a pass behind.
      expect(booking.tender.total).toBe(485);
      expect(booking.tender.leftToAllocate).toBe(0);
    });
  });

  // ---------------------------------------------------------- booking

  describe('taking the booking', () => {

    function readyFlowOne() {
      booking.chooseFunding('BANK_SELF');
      booking.fareText = '425';
      booking.onCommissionChange('60');
      booking.tender.line('CASH')!.amountTendered = '500';
    }

    it('will not book without the flow answered', () => {
      booking.onCommissionChange('60');
      booking.tender.line('CASH')!.amountTendered = '60';
      expect(booking.canBook).toBe(false);
    });

    it('will not book a shop-funded ticket with no fare typed', () => {
      booking.chooseFunding('BANK_SELF');
      booking.onCommissionChange('60');
      expect(booking.canBook).toBe(false);
    });

    it('will not book with no passengers', () => {
      booking.customerPaid();
      booking.onPassengersChange('0');
      expect(booking.canBook).toBe(false);
    });

    it('sends the booking and keeps the confirmation on screen', () => {
      readyFlowOne();
      booking.takeBooking();

      const sent = http.expectOne(`${base}/bookings`);
      expect(sent.request.method).toBe('POST');
      expect(sent.request.body.fareAmount).toBe(425);
      expect(sent.request.body.fundingAccountCode).toBe('BANK_SELF');
      expect(sent.request.body.settlementLines[0].amount).toBe(485);
      sent.flush(RESPONSE);

      expect(booking.booked?.bookingId).toBe(7);
      // The form clears for the next customer; the confirmation does not.
      expect(booking.fareText).toBe('');
      expect(booking.fundingAccountCode).toBeNull();
    });

    it('⚠ sends an Idempotency-Key, and a NEW one only after a booking succeeds', () => {
      readyFlowOne();
      booking.takeBooking();
      const first = http.expectOne(`${base}/bookings`);
      const firstKey = first.request.headers.get('Idempotency-Key');
      expect(firstKey).toBeTruthy();
      first.flush(RESPONSE);

      readyFlowOne();
      booking.takeBooking();
      const second = http.expectOne(`${base}/bookings`);
      expect(second.request.headers.get('Idempotency-Key')).not.toBe(firstKey);
      second.flush(RESPONSE);
    });

    it('⚠ KEEPS the key when a booking is refused, so a fix-and-retry cannot double-book', () => {
      readyFlowOne();
      booking.takeBooking();
      const first = http.expectOne(`${base}/bookings`);
      const key = first.request.headers.get('Idempotency-Key');
      first.flush({ code: 'TICKET_FUNDING_MISMATCH', message: 'no' },
        { status: 422, statusText: 'Unprocessable Entity' });

      expect(booking.bookError).toBeTruthy();

      booking.takeBooking();
      const retry = http.expectOne(`${base}/bookings`);
      // A refusal the staff can fix is followed by a retry of the SAME sale. A fresh
      // key would turn a timeout-then-fix into two bookings.
      expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
      retry.flush(RESPONSE);
    });

    it('shows the change to hand back when the server says to', () => {
      readyFlowOne();
      booking.takeBooking();
      http.expectOne(`${base}/bookings`).flush(RESPONSE);
      fixture.detectChanges();

      // ⚠ The SERVER's changeDisplayed flag, never re-derived from the threshold.
      expect(fixture.nativeElement.textContent).toContain('Hand back');
      expect(fixture.nativeElement.textContent).toContain('₹15.00');
    });
  });
});
