import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { SectionChromeModule } from '../../shared/section-chrome.module';
import {
  PageResponse,
  RechargeWorkItemResponse,
  SettlementLineResponse,
  TransactionResponse
} from '../model/recharge.models';
import { NumberGroupsPipe } from '../number-groups.pipe';
import { FailureComponent } from './failure.component';

function item(overrides: Partial<RechargeWorkItemResponse> = {}): RechargeWorkItemResponse {
  return {
    rechargeId: 99051,
    reference: 'R-99051',
    serviceType: 'TV',
    number: '1234567890',
    operatorCode: 'DISHTV',
    operatorName: 'Dish TV',
    routeCode: 'A1TOPUP',
    amount: 240,
    // ⚠ A DTH line, so there is a surcharge — which is the half of the money that the
    // retry carries over and the refund includes. A zero-surcharge fixture hides both.
    surcharge: 10,
    rechargeAt: '2026-10-13T14:06:00',
    paymentId: 73485,
    failureReason: 'operator declined',
    ...overrides
  };
}

function line(overrides: Partial<SettlementLineResponse> = {}): SettlementLineResponse {
  return {
    lineId: 1,
    method: 'CASH',
    amount: 250,
    amountTendered: 300,
    changeGiven: 50,
    changeDisplayed: true,
    reference: null,
    customerId: null,
    customerName: null,
    extendedBy: null,
    note: null,
    ...overrides
  };
}

function payment(lines: SettlementLineResponse[]): TransactionResponse {
  return {
    paymentId: 73485,
    paymentReference: 'P-73485',
    takenAt: '2026-10-13T14:05:00',
    staff: 'Jaydeep',
    financialYear: '2026-27',
    totalDue: 250,
    totalSurcharge: 10,
    cashTendered: 300,
    changeDue: 50,
    recharges: [],
    settlementLines: lines,
    credit: null
  };
}

function pageOf(content: RechargeWorkItemResponse[]): PageResponse<RechargeWorkItemResponse> {
  return { content, page: 0, size: 100, totalElements: content.length, totalPages: 1 };
}

describe('FailureComponent', () => {
  let fixture: ComponentFixture<FailureComponent>;
  let failure: FailureComponent;
  let http: HttpTestingController;
  // ⚠ A subject, not `of`, so a test can route to a DIFFERENT :failedId on the same
  // component instance — which is what Angular does, and what finding 9 was about.
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const base = `${environment.apiUrl}/recharge`;

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({ failedId: '99051' }));
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule, RouterTestingModule, SectionChromeModule],
      declarations: [FailureComponent, NumberGroupsPipe],
      providers: [{ provide: ActivatedRoute, useValue: { paramMap: params } }]
    }).compileComponents();

    fixture = TestBed.createComponent(FailureComponent);
    failure = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.match(() => true);
    http.verify();
  });

  /** Loads the failure, and the payment whose tender rows decide the refund modes. */
  function load(
    row: RechargeWorkItemResponse = item(),
    lines: SettlementLineResponse[] = [line()]
  ): void {
    http.expectOne((r) => r.url === `${base}/recharges/failures`).flush(pageOf([row]));
    http.expectOne(`${base}/transactions/${row.paymentId}`).flush(payment(lines));
    fixture.detectChanges();
  }

  // ------------------------------------------------- the stale text is gone

  /**
   * ⚠ The text this replaces was wrong, visible, and being read at the counter: it told
   * staff "Both need endpoints the counter slice did not build" after both had been built.
   */
  it('no longer tells staff the resolutions cannot be done', () => {
    load();
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Neither of these can be done yet');
    expect(text).not.toContain('did not build');
  });

  it('offers both resolutions as live controls', () => {
    load();
    const choices = fixture.nativeElement.querySelectorAll('.choice');
    expect(choices.length).toBe(2);
    expect(Array.from(choices).every((c) => !(c as HTMLButtonElement).disabled)).toBe(true);
  });

  // ------------------------------------------------- what is held

  /** The line's own total, not the whole payment, and the surcharge is in it. */
  it('holds the line total including our charge', () => {
    load();
    expect(failure.held).toBe(250);
  });

  // ------------------------------------------------- the retry

  it('starts a retry at the amount that failed', () => {
    load();
    failure.openRetry();
    expect(failure.retryAmount).toBe(240);
    expect(failure.retryDirection).toBe('same');
  });

  /**
   * ⚠ Neither settlement field on an equal-amount retry. Sending either is a 422
   * `UNSETTLED_DIFFERENCE`, refused rather than ignored so a dropped cash-back cannot
   * leave the staff member believing money changed hands.
   */
  it('sends no settlement at all when the amount has not moved', () => {
    load();
    failure.openRetry();
    failure.submitRetry();

    const request = http.expectOne(`${base}/recharges/99051/retry`);
    expect(request.request.body).toEqual({ amount: 240 });
    request.flush({ newRecharge: item({ rechargeId: 99052, reference: 'R-99052' }) });
  });

  it('settles a lower retry as a difference going out', () => {
    load();
    failure.openRetry();
    failure.retryAmount = 199;
    expect(failure.retryDirection).toBe('lower');
    expect(failure.retryDifference).toBe(41);

    failure.chooseDifferenceMode('CASH');
    failure.submitRetry();

    const request = http.expectOne(`${base}/recharges/99051/retry`);
    expect(request.request.body).toEqual({
      amount: 199,
      differenceSettlement: { mode: 'CASH', customerId: null, note: null }
    });
    request.flush({ newRecharge: item({ rechargeId: 99052 }) });
  });

  it('settles a higher retry as a top-up coming in', () => {
    load();
    failure.openRetry();
    failure.retryAmount = 299;
    expect(failure.retryDirection).toBe('higher');
    expect(failure.retryDifference).toBe(59);

    failure.chooseTopUpMethod('UPI');
    failure.submitRetry();

    const request = http.expectOne(`${base}/recharges/99051/retry`);
    expect(request.request.body).toEqual({
      amount: 299,
      topUp: { method: 'UPI', customerId: null, note: null }
    });
    request.flush({ newRecharge: item({ rechargeId: 99052 }) });
  });

  /**
   * ⚠ The surcharge carries over UNCHANGED, so the amount typed is the face value and the
   * difference is the change in face value alone. Reading the ₹10 into the difference is
   * the commonest way to get this screen wrong.
   */
  it('keeps our charge out of the difference and says what it adds to', () => {
    load();
    failure.openRetry();
    failure.retryAmount = 199;
    fixture.detectChanges();

    expect(failure.retryDifference).toBe(41);
    expect(failure.retryTotal).toBe(209);
    expect(fixture.nativeElement.textContent as string).toContain('carries over unchanged');
  });

  /** A direction with no answer cannot be sent, so the 422 is never provoked. */
  it('refuses to send a lower retry with no settlement chosen', () => {
    load();
    failure.openRetry();
    failure.retryAmount = 199;
    expect(failure.retryReady).toBe(false);

    failure.chooseDifferenceMode('CASH');
    expect(failure.retryReady).toBe(true);
  });

  /**
   * ⚠ THIS REPLACES "needs a named customer before keeping a difference on account".
   * `KEEP_AS_ADVANCE` was the only mode that named one, and it was withdrawn on
   * 2026-10-21 (log §16.2). `UPI` took its place and asks for something else: the
   * transaction reference, which is the only trace from the `UPI_CLEARING` leg back to the
   * actual transfer. The shape of the assertion is the same — a mode with an unmet
   * requirement cannot be sent, so the 422 is never provoked.
   */
  it('needs the transaction reference before sending a difference back by UPI', () => {
    load(item(), [line({ method: 'UPI', amount: 250, amountTendered: null, changeGiven: null })]);
    failure.openRetry();
    failure.retryAmount = 199;
    failure.chooseDifferenceMode('UPI');
    expect(failure.retryReady).toBe(false);

    failure.retryNote = '   ';
    expect(failure.retryReady).toBe(false);

    failure.retryNote = 'UPI-OUT-4420';
    expect(failure.retryReady).toBe(true);
  });

  /**
   * ⚠ A customer left over from an earlier choice must not ride along on a CASH
   * settlement: the server would take it as naming an account, and the staff member would
   * believe cash went over the counter while the money sat on someone's name.
   *
   * No residual mode names a customer any more — `KEEP_AS_ADVANCE` was the one that did —
   * so the leftover now comes from a CREDIT top-up, which still asks. The clearing rule is
   * what is being asserted, and it is unchanged.
   */
  it('drops a chosen customer when the mode stops needing one', () => {
    load();
    failure.openRetry();
    failure.retryAmount = 349;
    failure.chooseTopUpMethod('CREDIT');
    failure.chooseCustomer({
      customerId: 4821, name: 'Sunil Patil', contactNumber: '9823011111',
      outstanding: 0, advanceHeld: 0, oldestDebtDays: null, warn: false
    });

    failure.retryAmount = 199;
    failure.chooseDifferenceMode('CASH');
    expect(failure.chosenCustomer).toBeNull();

    failure.submitRetry();
    const request = http.expectOne(`${base}/recharges/99051/retry`);
    expect((request.request.body as { differenceSettlement: { customerId: number | null } })
      .differenceSettlement.customerId).toBeNull();
    request.flush({ newRecharge: item({ rechargeId: 99052 }) });
  });

  // ------------------------------------------------- the refund

  /**
   * ⚠ NOT TYPED. A partial refund is a 422 because `REFUNDED` is terminal, so the amount
   * is the whole line and there is no input to get it wrong in.
   */
  it('refunds the whole line and offers no amount to edit', () => {
    load();
    failure.openRefund();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.refund-figure')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#refund-amount')).toBeNull();

    // Cash is the only mode on a cash-only sale, so it is pre-picked — but choosing it
    // explicitly is what this test is about sending, not what it is about offering.
    failure.chooseRefundMode('CASH');
    failure.submitRefund();
    const request = http.expectOne(`${base}/recharges/99051/refund`);
    expect(request.request.body).toEqual({
      amount: 250, mode: 'CASH', customerId: null, note: null
    });
    request.flush({ recharge: item(), amount: 250, mode: 'CASH', credit: null });
  });

  /**
   * ⚠ ONE MODE PER TENDER LINE, with no unconditional fallback. A cash-only sale offers
   * cash back and nothing else, which is a narrowing: `KEEP_AS_ADVANCE` used to be offered
   * here too, on every payment, and that is what let a UPI-only sale reach a one-way door
   * (log §16.2).
   */
  it('offers cash back and only that on a cash sale', () => {
    load();
    expect(failure.residualModes).toEqual(['CASH']);
    failure.openRefund();
    expect(failure.refundMode).toBe('CASH');
  });

  /**
   * ⚠ THE SHARP CASE, AND THE ONE THIS CHANGE EXISTS FOR. A UPI-only payment collected no
   * cash, so there is none to hand back. Until 2026-10-21 the only mode left was
   * `KEEP_AS_ADVANCE`, which credited `ADV_RECHARGE` — an account nothing debits, with no
   * `SettlementMethod.ADVANCE` to draw it down and invisible to the credit book. The money
   * stopped being held and started being owed instead, forever. Observed live on
   * 2026-10-19: ₹250 kept, `advanceHeld` 0.00, an empty statement.
   *
   * It now goes back down the rail it came in on, and the reference is what the screen
   * asks for instead of a customer.
   */
  it('sends a UPI sale back by UPI, and asks for the reference rather than a customer', () => {
    load(item(), [line({ method: 'UPI', amount: 250, amountTendered: null, changeGiven: null })]);

    expect(failure.noCashToReturn).toBe(true);
    expect(failure.residualModes).toEqual(['UPI']);
    expect(failure.needsCustomer('UPI')).toBe(false);
    expect(failure.needsReference('UPI')).toBe(true);

    failure.openRefund();
    fixture.detectChanges();
    expect(failure.refundMode).toBe('UPI');
    expect(failure.refundReady).toBe(false);
    expect(fixture.nativeElement.textContent as string).toContain('No cash was collected');
    expect(fixture.nativeElement.textContent as string).toContain('UPI transaction reference');

    failure.refundNote = 'UPI-OUT-4421';
    expect(failure.refundReady).toBe(true);

    failure.submitRefund();
    const request = http.expectOne(`${base}/recharges/99051/refund`);
    expect(request.request.body).toEqual({
      amount: 250, mode: 'UPI', customerId: null, note: 'UPI-OUT-4421'
    });
    request.flush({ recharge: item(), amount: 250, mode: 'UPI', credit: null });

    expect(failure.outcomeSentence).toContain('sent back by UPI');
  });

  /** ⚠ A blank reference is refused before the request goes, not after a 422. */
  it('will not send a UPI refund with a blank reference', () => {
    load(item(), [line({ method: 'UPI', amount: 250, amountTendered: null, changeGiven: null })]);
    failure.openRefund();

    failure.refundNote = '   ';
    expect(failure.refundReady).toBe(false);

    failure.submitRefund();
    http.expectNone(`${base}/recharges/99051/refund`);
  });

  /**
   * ⚠ `CREDIT_REDUCTION` goes to the ORIGINAL credit line's customer and the server
   * ignores a `customerId` in the request, so the screen names that person instead of
   * asking — picking a different one would move a debt between two people's accounts.
   */
  it('names the credit line’s customer rather than asking who to credit', () => {
    load(item(), [line({ method: 'CREDIT', amount: 250, customerId: 4821, customerName: 'Sunil Patil' })]);

    expect(failure.residualModes).toEqual(['CREDIT_REDUCTION']);
    expect(failure.needsCustomer('CREDIT_REDUCTION')).toBe(false);
    expect(failure.modeNote('CREDIT_REDUCTION')).toContain('Sunil Patil');

    failure.openRefund();
    failure.chooseRefundMode('CREDIT_REDUCTION');
    expect(failure.refundReady).toBe(true);

    failure.submitRefund();
    const request = http.expectOne(`${base}/recharges/99051/refund`);
    expect((request.request.body as { customerId: number | null }).customerId).toBeNull();
    request.flush({ recharge: item(), amount: 250, mode: 'CREDIT_REDUCTION', credit: null });
  });

  /**
   * ⚠ When the payment could not be read there ARE no tender rows to reason from — and
   * since 2026-10-21 there is no always-available mode to fall back on either. Every mode
   * now asserts something about the original payment, so the screen offers NOTHING and says
   * why, rather than inventing a default that could send money out by a rail the sale never
   * came in on.
   */
  it('offers no mode at all when the payment could not be read, and says why', () => {
    http.expectOne((r) => r.url === `${base}/recharges/failures`).flush(pageOf([item()]));
    http.expectOne(`${base}/transactions/73485`).error(new ProgressEvent('failed'));
    fixture.detectChanges();

    expect(failure.paymentUnread).toBe(true);
    expect(failure.modesUnknown).toBe(true);
    expect(failure.residualModes).toEqual([]);

    failure.openRefund();
    fixture.detectChanges();
    expect(failure.refundMode).toBeNull();
    expect(failure.refundReady).toBe(false);
    expect(fixture.nativeElement.textContent as string).toContain('could not be read');
  });

  /** A 422 narrows the list to exactly what the server said is available. */
  it('takes the available modes from the server’s refusal', () => {
    load();
    failure.openRefund();
    failure.chooseRefundMode('CASH');
    failure.submitRefund();

    http.expectOne(`${base}/recharges/99051/refund`).flush(
      {
        code: 'REFUND_MODE_NOT_AVAILABLE',
        message: 'CASH is not available here: no cash was collected on payment P-73485.',
        details: { requested: 'CASH', available: ['UPI'] }
      },
      { status: 422, statusText: 'Unprocessable Entity' }
    );
    fixture.detectChanges();

    expect(failure.residualModes).toEqual(['UPI']);
    // ⚠ And the mode the server just refused is cleared, not left selected.
    expect(failure.refundMode).toBeNull();
  });

  /**
   * ⚠ Pressing Change and typing the SAME name used to be dropped as a duplicate, so the
   * screen told the staff member "Nobody by that name or mobile" about a customer who
   * exists — with the refund unsendable until they typed something else.
   */
  it('finds the same customer again after Change', fakeAsync(() => {
    load(item(), [line({ method: 'UPI', amount: 250, amountTendered: null, changeGiven: null })]);
    failure.openRefund();

    failure.onCustomerQuery('asha');
    tick(250);
    http.expectOne((r) => r.url === `${base}/customers`).flush([{
      customerId: 4822, name: 'Asha Kale', contactNumber: '9823022222',
      outstanding: 0, advanceHeld: 0, oldestDebtDays: null, warn: false
    }]);
    failure.chooseCustomer(failure.customerResults[0]);
    tick(250);

    failure.clearCustomer();
    tick(250);

    failure.onCustomerQuery('asha');
    tick(250);
    const again = http.expectOne((r) => r.url === `${base}/customers`);
    expect(again.request.params.get('query')).toBe('asha');
    again.flush([]);
  }));

  /**
   * ⚠ An EMPTY `details.available` is truthy, so it used to replace the derived list and
   * leave the panel with no mode buttons at all, permanently unsendable and silent.
   */
  it('keeps its own modes when the server sends an empty available list', () => {
    load();
    failure.openRefund();
    failure.chooseRefundMode('CASH');
    failure.submitRefund();

    http.expectOne(`${base}/recharges/99051/refund`).flush(
      {
        code: 'REFUND_MODE_NOT_AVAILABLE',
        message: 'CASH is not available here.',
        details: { requested: 'CASH', available: [] }
      },
      { status: 422, statusText: 'Unprocessable Entity' }
    );
    fixture.detectChanges();

    expect(failure.residualModes.length).toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelectorAll('.mode').length).toBeGreaterThan(0);
  });

  /**
   * ⚠ `RetryRechargeRequest` has no top-level note — it hangs off the settlement, and an
   * equal-amount retry sends no settlement. The panel OPENS on that case, so a note
   * offered there would be typed and silently dropped.
   */
  it('does not offer a note on the retry that cannot carry one', () => {
    load();
    failure.openRetry();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#retry-note')).toBeNull();

    failure.retryAmount = 199;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#retry-note')).not.toBeNull();
  });

  // ------------------------------------------------- losing the race

  /**
   * ⚠ A 409 is NOT an error to retry. V29's unique retry key decides the race in the
   * database, so the work the request would repeat has already happened — showing it as a
   * failure invites a second attempt at a finished job.
   */
  it('treats a duplicate retry as work already done, not as an error', () => {
    load();
    failure.openRetry();
    failure.submitRetry();

    http.expectOne(`${base}/recharges/99051/retry`).flush(
      { code: 'DUPLICATE_RETRY', message: 'Recharge 99051 has already been retried.' },
      { status: 409, statusText: 'Conflict' }
    );
    fixture.detectChanges();

    expect(failure.alreadyDone).toBe(true);
    expect(failure.submitError).toBe('');
    expect(failure.panel).toBe('none');

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Someone got there first');
    // The way out is a re-read, and the resolution buttons are not offered again.
    expect(fixture.nativeElement.querySelector('.choice')).toBeNull();
  });

  // ------------------------------------------------- what came back

  it('reads the outcome off the response rather than re-asking', fakeAsync(() => {
    load();
    failure.openRetry();
    failure.retryAmount = 199;
    failure.chooseDifferenceMode('CASH');
    failure.submitRetry();

    http.expectOne(`${base}/recharges/99051/retry`).flush({
      newRecharge: item({ rechargeId: 99052, reference: 'R-99052', amount: 199 }),
      originalRecharge: item(),
      differenceOwed: 41,
      differenceSettledAs: 'CASH',
      topUpTaken: null,
      topUpTakenAs: null,
      credit: null
    });
    // ⚠ 250, not 0. `chooseDifferenceMode` clears any chosen customer, and that clear is
    // now an event on the search probe — which is what lets `switchMap` cancel a lookup
    // already in flight. It carries the probe's debounce with it.
    tick(250);
    fixture.detectChanges();

    expect(failure.settled).toBe(true);
    expect(failure.outcomeSentence).toBe('₹41.00 difference handed back in cash.');
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('R-99052');
    expect(text).toContain('on the worklist');
  }));

  /**
   * ⚠ Possessive when a name is known. The real screen read "taken off Ravi More tab",
   * which is what a template gets when it treats a name and "their" as interchangeable.
   */
  it('names whose account it landed on, possessively', () => {
    load(item(), [line({ method: 'CREDIT', amount: 250, customerId: 3, customerName: 'Ravi More' })]);
    failure.openRefund();
    failure.chooseRefundMode('CREDIT_REDUCTION');
    failure.submitRefund();

    http.expectOne(`${base}/recharges/99051/refund`).flush({
      recharge: item(),
      amount: 199,
      mode: 'CREDIT_REDUCTION',
      credit: {
        customerId: 3, customerName: 'Ravi More', amountExtended: 0,
        outstandingAfter: 0, advanceHeld: 0, oldestDebtDays: null, warn: false
      }
    });

    expect(failure.outcomeSentence).toBe('₹199.00 taken off Ravi More\'s tab.');
  });

  /**
   * And "their" when the response carries no name, which must not read as a name.
   *
   * ⚠ Only `CREDIT_REDUCTION` reaches `whose()` now. `KEEP_AS_ADVANCE` was the other
   * caller and it was withdrawn (log §16.2); `CASH` and `UPI` name nobody, because the
   * accounts they credit are `REQUIRES_PARTY = FALSE` and the walk-in stays anonymous.
   */
  it('falls back to “their” when no customer came back', () => {
    load(item(), [line({ method: 'CREDIT', amount: 250, customerId: 3, customerName: 'Ravi More' })]);
    failure.openRefund();
    failure.chooseRefundMode('CREDIT_REDUCTION');
    failure.submitRefund();

    http.expectOne(`${base}/recharges/99051/refund`).flush({
      recharge: item(), amount: 250, mode: 'CREDIT_REDUCTION', credit: null
    });

    expect(failure.outcomeSentence).toBe('₹250.00 taken off their tab.');
  });

  /**
   * ⚠ Angular REUSES this component when only `:failedId` changes, so a resolution
   * recorded for one recharge left its "Sorted" card and its outcome sentence on screen
   * for the next one — with the retry and refund choices hidden behind `settled`.
   */
  it('does not carry one recharge’s outcome onto the next', () => {
    load();
    failure.openRefund();
    failure.chooseRefundMode('CASH');
    failure.submitRefund();
    http.expectOne(`${base}/recharges/99051/refund`).flush({
      recharge: item(), amount: 250, mode: 'CASH', credit: null
    });
    fixture.detectChanges();
    expect(failure.settled).toBe(true);

    // Route to a different failure on the same instance.
    params.next(convertToParamMap({ failedId: '99052' }));
    load(item({ rechargeId: 99052, reference: 'R-99052' }));

    expect(failure.settled).toBe(false);
    expect(failure.outcomeSentence).toBe('');
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Sorted');
    // And the resolutions are offered again for the new one.
    expect(fixture.nativeElement.querySelectorAll('.choice').length).toBe(2);
  });

  it('says a refund is the end of the line', () => {
    load();
    failure.openRefund();
    failure.chooseRefundMode('CASH');
    failure.submitRefund();

    http.expectOne(`${base}/recharges/99051/refund`).flush({
      recharge: item(),
      amount: 250,
      mode: 'CASH',
      credit: null
    });
    fixture.detectChanges();

    expect(failure.outcomeSentence).toBe('₹250.00 handed back in cash.');
    expect(fixture.nativeElement.textContent as string).toContain('end of the');
  });
});
