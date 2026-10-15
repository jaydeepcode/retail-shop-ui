import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { SectionChromeModule } from '../../shared/section-chrome.module';
import { environment } from '../../../../environments/environment';
import { CounterConfigResponse, TransactionResponse } from '../model/recharge.models';
import { CounterComponent } from './counter.component';

const CONFIG: CounterConfigResponse = {
  operators: [
    {
      code: 'JIO',
      name: 'Jio',
      serviceType: 'MOBILE',
      defaultRouteCode: 'DIRECT',
      presets: [299, 123, 349, 239]
    },
    // ⚠ Vi has none. §14.10 measured the pre-merge VI code at 23 recharges, "too thin to
    // preset", and V20 then merged IDEA into VI — so the shop's third-largest float has
    // no chips. Open item 1. The screen must render a bare field, not a spinner.
    { code: 'VI', name: 'Vi', serviceType: 'MOBILE', defaultRouteCode: 'DIRECT', presets: [] },
    // TV operators have none at all, by measurement.
    {
      code: 'DISHTV',
      name: 'Dish Tv',
      serviceType: 'TV',
      defaultRouteCode: 'A1TOPUP',
      presets: []
    }
  ],
  routes: [
    { code: 'DIRECT', name: 'Direct' },
    { code: 'A1TOPUP', name: 'A1Topup' }
  ],
  creditWarningDays: 30,
  fyStartMonth: 4,
  currentFinancialYear: '2026-27',
  changeDisplayThreshold: 5,
  surchargeDefaultTv: 10,
  surchargeDefaultMobile: 0
};

function transaction(overrides: Partial<TransactionResponse> = {}): TransactionResponse {
  return {
    paymentId: 73485,
    paymentReference: 'P-73485',
    takenAt: '2026-10-13T14:06:00',
    staff: 'jaydeep',
    financialYear: '2026-27',
    totalDue: 299,
    totalSurcharge: 0,
    cashTendered: 300,
    changeDue: 1,
    recharges: [
      {
        rechargeId: 99051,
        reference: 'R-99051',
        serviceType: 'MOBILE',
        number: '9823014772',
        operatorCode: 'JIO',
        operatorName: 'Jio',
        routeCode: 'DIRECT',
        routeName: 'Direct',
        routeConfirmed: false,
        amount: 299,
        surcharge: 0,
        status: 'AWAITING_RECHARGE',
        resolution: 'NONE',
        vendorRef: null,
        retryOfRechargeId: null,
        failureReason: null,
        rechargeAt: '2026-10-13T14:06:00',
        statusChangedAt: '2026-10-13T14:06:00'
      }
    ],
    settlementLines: [
      {
        lineId: 1,
        method: 'CASH',
        amount: 299,
        amountTendered: 300,
        changeGiven: 1,
        // ⚠ ₹1 is change the customer waves away, so the server says do not show it.
        changeDisplayed: false,
        reference: null,
        customerId: null,
        customerName: null,
        extendedBy: null,
        note: null
      }
    ],
    credit: null,
    ...overrides
  };
}

describe('CounterComponent', () => {
  let fixture: ComponentFixture<CounterComponent>;
  let counter: CounterComponent;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/recharge`;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule, RouterTestingModule, SectionChromeModule],
      declarations: [CounterComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(CounterComponent);
    counter = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(`${base}/config`).flush(CONFIG);
    fixture.detectChanges();
  });

  afterEach(() => {
    // Drain anything still in flight (a background refresh, say) WITHOUT flushing a body
    // into it: match() removes the requests, so verify() is still meaningful about the
    // ones each test asserted on.
    http.match(() => true);
    http.verify();
  });

  // ---------------------------------------------------------------- presets

  it('shows an operator its own presets', () => {
    counter.chooseOperator('JIO');
    expect(counter.presets).toEqual([299, 123, 349, 239]);
  });

  it('renders a bare amount field for an operator with no presets, not a spinner', () => {
    counter.chooseOperator('VI');
    fixture.detectChanges();
    expect(counter.presets).toEqual([]);
    const html = fixture.nativeElement.textContent as string;
    expect(html).toContain('No common amounts on file for Vi');
    expect(fixture.nativeElement.querySelector('.chip-amount')).toBeNull();
    // And the field itself is still there to type into.
    expect(fixture.nativeElement.querySelector('#counter-amount')).toBeTruthy();
  });

  it('gives TV a stepper instead of chips', () => {
    counter.chooseService('TV');
    fixture.detectChanges();
    expect(counter.usesStepper).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('.stepper').length).toBe(2);
  });

  it('steps the TV amount by ten and never below zero', () => {
    counter.chooseService('TV');
    counter.amountText = '240';
    counter.stepAmount(10);
    expect(counter.amountText).toBe('250');
    counter.amountText = '5';
    counter.stepAmount(-10);
    expect(counter.amountText).toBe('0');
  });

  // ---------------------------------------------------------------- surcharge

  it('⚠ offers our charge on TV only, never on mobile', () => {
    // Owner, 2026-10-15: "only applicable for TV, not for Mobile". It used to be
    // shown on both — defaulted to 10 on TV and blank on mobile, per log §15.11 —
    // which left an always-blank box on every mobile sale for staff to ignore.
    //
    // The DATA side of §15.11 is untouched: rc_recharge.SURCHARGE and V28's
    // ck_rech_surcharge (>= 0, deliberately not keyed to RECHARGE_KIND) still
    // allow a mobile surcharge, so the 198 historical mobile-attached cases stay
    // reproducible and the API still accepts one. Only this screen narrows.
    expect(counter.serviceType).toBe('MOBILE');
    expect(counter.chargeApplies).toBe(false);

    counter.chooseService('TV');
    expect(counter.chargeApplies).toBe(true);
    expect(counter.surchargeText).toBe('10');
  });

  it('the charge field is absent from the DOM on mobile', () => {
    // Asserted on the rendered template, not just the getter: the field being
    // hidden is the whole of what the owner asked for.
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#counter-surcharge')).toBeNull();

    counter.chooseService('TV');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#counter-surcharge')).not.toBeNull();
  });

  it('never sends a surcharge on a mobile line, even one left over from a TV entry', () => {
    // The sequence that would have leaked one: start on TV, type a charge, switch
    // to mobile without clearing it. surchargeTouched is still true, so the guard
    // has to be on chargeApplies rather than on the touched flag alone.
    counter.chooseService('TV');
    counter.onSurchargeInput('10');

    counter.chooseService('MOBILE');
    counter.numberText = '9000000002';
    counter.chooseOperator('JIO');
    counter.amountText = '199';
    counter.addToBasket();

    expect(counter.basket.length).toBe(1);
    expect(counter.basket[0].surcharge).toBeUndefined();
  });

  it('omits the surcharge when untouched, so the server stays authoritative', () => {
    counter.chooseService('TV');
    counter.numberText = '02700000001';
    counter.chooseOperator('DISHTV');
    counter.amountText = '240';
    counter.addToBasket();
    expect(counter.basket[0].surcharge).toBeUndefined();
  });

  it('sends an explicit zero when the staff clear our charge on a DTH line', () => {
    counter.chooseService('TV');
    counter.numberText = '02700000001';
    counter.chooseOperator('DISHTV');
    counter.amountText = '240';
    counter.onSurchargeInput('');
    counter.addToBasket();
    expect(counter.basket[0].surcharge).toBe(0);
  });

  // ---------------------------------------------------------------- basket

  it('rejects a mobile number that is not ten digits before calling anything', () => {
    counter.numberText = '98230';
    counter.chooseOperator('JIO');
    counter.amountText = '299';
    counter.addToBasket();
    expect(counter.basket.length).toBe(0);
    expect(counter.entryError).toContain('10 digits');
  });

  it('mints a new idempotency key whenever the basket changes', () => {
    const keyOf = () => (counter as unknown as Record<string, string>)['idempotencyKey'];
    const before = keyOf();
    counter.numberText = '9823014772';
    counter.chooseOperator('JIO');
    counter.amountText = '299';
    counter.addToBasket();
    const afterAdd = keyOf();
    expect(afterAdd).not.toBe(before);
    counter.removeLine(0);
    expect(keyOf()).not.toBe(afterAdd);
  });

  // ---------------------------------------------------------------- settling

  function addJioLine(): void {
    counter.numberText = '9823014772';
    counter.chooseOperator('JIO');
    counter.amountText = '299';
    counter.addToBasket();
  }

  it('settles with the key it holds and moves to the waiting state', () => {
    addJioLine();
    // As ngModel writes it: a string from a text input.
    counter.line('CASH')!.amountTendered = '300';
    const key = (counter as unknown as Record<string, string>)['idempotencyKey'];
    counter.takePayment();

    const request = http.expectOne(`${base}/transactions`);
    expect(request.request.headers.get('Idempotency-Key')).toBe(key);
    // No total, no change, no status, no route in the body.
    expect(request.request.body.recharges[0]).toEqual({
      serviceType: 'MOBILE',
      number: '9823014772',
      operatorCode: 'JIO',
      amount: 299
    });
    // ⚠ Numbers on the wire, even though the tender was typed into a text input.
    expect(request.request.body.settlementLines[0].amount).toBe(299);
    expect(request.request.body.settlementLines[0].amountTendered).toBe(300);
    expect(typeof request.request.body.settlementLines[0].amountTendered).toBe('number');

    request.flush(transaction());
    fixture.detectChanges();

    expect(counter.state).toBe('waiting');
  });

  it('keeps the same key when a settle is retried after a failure', () => {
    addJioLine();
    const key = (counter as unknown as Record<string, string>)['idempotencyKey'];
    counter.takePayment();
    http.expectOne(`${base}/transactions`).flush(
      { code: 'INTERNAL_ERROR', message: 'boom', traceId: 'a' },
      { status: 500, statusText: 'Server Error' }
    );
    expect(counter.state).toBe('entry');

    counter.takePayment();
    const retry = http.expectOne(`${base}/transactions`);
    expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
    retry.flush(transaction());
  });

  it('puts the cursor on the line the server named in fieldErrors', () => {
    addJioLine();
    counter.takePayment();
    http.expectOne(`${base}/transactions`).flush(
      {
        code: 'INVALID_REQUEST',
        message: 'bad',
        traceId: 'a',
        fieldErrors: [{ field: 'recharges[0].amount', message: 'an amount is at least 1.00' }]
      },
      { status: 400, statusText: 'Bad Request' }
    );
    expect(counter.badLineIndex).toBe(0);
  });

  // ---------------------------------------------------------------- change

  it('shows no change row when the server says the change is not displayed', () => {
    addJioLine();
    counter.takePayment();
    http.expectOne(`${base}/transactions`).flush(transaction());
    fixture.detectChanges();

    // ₹1 of change exists on the line and is deliberately not surfaced.
    expect(counter.held!.settlementLines[0].changeGiven).toBe(1);
    expect(counter.changeToShow).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('nothing to hand back');
  });

  it('shows the change the server does display, without re-deriving it', () => {
    addJioLine();
    counter.takePayment();
    const settled = transaction();
    settled.settlementLines[0] = {
      ...settled.settlementLines[0],
      amountTendered: 500,
      changeGiven: 201,
      changeDisplayed: true
    };
    http.expectOne(`${base}/transactions`).flush(settled);
    fixture.detectChanges();

    expect(counter.changeToShow).toBe(201);
    expect(fixture.nativeElement.textContent).toContain('hand back');
  });

  // ---------------------------------------------------------------- answering

  it('answers one recharge per call, never in bulk', () => {
    addJioLine();
    counter.takePayment();
    const two = transaction();
    two.recharges = [
      two.recharges[0],
      { ...two.recharges[0], rechargeId: 99052, reference: 'R-99052', number: '9881203114' }
    ];
    http.expectOne(`${base}/transactions`).flush(two);
    fixture.detectChanges();

    expect(counter.current!.rechargeId).toBe(99051);
    counter.markDone();
    http.expectOne(`${base}/recharges/99051/complete`).flush(two.recharges[0]);
    fixture.detectChanges();

    // The second one is now in hand — and nothing was sent for it until the first answered.
    expect(counter.state).toBe('waiting');
    expect(counter.current!.rechargeId).toBe(99052);

    counter.markDone();
    http.expectOne(`${base}/recharges/99052/complete`).flush(two.recharges[1]);
    fixture.detectChanges();
    expect(counter.state).toBe('entry');
  });

  it('sends the route override on completion, which is the only moment it can be set', () => {
    addJioLine();
    counter.takePayment();
    http.expectOne(`${base}/transactions`).flush(transaction());
    fixture.detectChanges();

    counter.routeOverride = 'A1TOPUP';
    counter.vendorRef = ' ABC123 ';
    counter.markDone();
    const request = http.expectOne(`${base}/recharges/99051/complete`);
    expect(request.request.body).toEqual({ vendorRef: 'ABC123', routeCode: 'A1TOPUP' });
    request.flush(transaction().recharges[0]);
  });

  it('attributes no route when a recharge failed, because none was consumed', () => {
    addJioLine();
    counter.takePayment();
    http.expectOne(`${base}/transactions`).flush(transaction());
    fixture.detectChanges();

    counter.routeOverride = 'A1TOPUP';
    counter.markFailed();
    const request = http.expectOne(`${base}/recharges/99051/fail`);
    expect(request.request.body).toEqual({});
    request.flush(transaction().recharges[0]);
  });

  it('holds the sale after payment rather than clearing the screen', () => {
    addJioLine();
    counter.takePayment();
    http.expectOne(`${base}/transactions`).flush(transaction());
    fixture.detectChanges();
    expect(counter.state).toBe('waiting');
    expect(counter.basket.length).toBe(1);
  });

  it('sets a sale aside and returns an empty counter', () => {
    addJioLine();
    counter.takePayment();
    http.expectOne(`${base}/transactions`).flush(transaction());
    fixture.detectChanges();

    counter.setAside();
    fixture.detectChanges();
    expect(counter.state).toBe('entry');
    expect(counter.basket).toEqual([]);
    expect(counter.held).toBeNull();
  });

  // ---------------------------------------------------------------- payment panel

  it('starts on one method, cash, with splitting opt-in', () => {
    expect(counter.payment.length).toBe(1);
    expect(counter.payment[0].method).toBe('CASH');
    expect(counter.isSingleMethod).toBe(true);
  });

  it('refuses to drop the last payment line', () => {
    counter.toggleMethod('CASH');
    expect(counter.payment.length).toBe(1);
  });

  it('will not take a credit payment without a named customer', () => {
    addJioLine();
    counter.toggleMethod('CREDIT');
    counter.line('CREDIT')!.amount = 299;
    counter.line('CASH')!.amount = 0;
    expect(counter.canTakePayment).toBe(false);
  });

  it('requires split lines to add up before the button works', () => {
    addJioLine();
    counter.toggleMethod('UPI');
    counter.line('CASH')!.amount = 100;
    counter.line('UPI')!.amount = 100;
    expect(counter.leftToAllocate).toBe(99);
    expect(counter.canTakePayment).toBe(false);

    counter.line('UPI')!.amount = 199;
    expect(counter.leftToAllocate).toBe(0);
    expect(counter.canTakePayment).toBe(true);
  });

  // ---------------------------------------------------------------- credit

  function creditCustomer(overrides = {}) {
    return {
      customerId: 403, name: 'Ramesh Pawar', contactNumber: '9960448201',
      outstanding: 340, advanceHeld: 0, oldestDebtDays: 54, warn: true, ...overrides
    };
  }

  function addJioLineAndCredit() {
    addJioLine();
    counter.toggleMethod('CREDIT');
    counter.toggleMethod('CASH');          // credit alone, so it covers the basket
  }

  it('shows what the customer will owe after this sale, which artboard 3 draws', () => {
    addJioLineAndCredit();
    counter.chooseCustomer(creditCustomer());
    fixture.detectChanges();
    // 340 already owed + 299 on this sale.
    expect(counter.willOweAfterThis).toBe(639);
    expect(fixture.nativeElement.textContent).toContain('Will owe after this');
    expect(fixture.nativeElement.textContent).toContain('639.00');
  });

  /** §14.8's mirror rule: a charge consumes any advance first, then becomes debt. */
  it('spends an advance before creating debt, matching what the server will do', () => {
    addJioLineAndCredit();
    counter.chooseCustomer(creditCustomer({ customerId: 287, outstanding: 0, advanceHeld: 37, warn: false }));
    fixture.detectChanges();
    expect(counter.willOweAfterThis).toBe(262);     // 299 - 37
    expect(counter.advanceLeftAfterThis).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('comes off what they already have with us');
  });

  it('leaves an advance that more than covers the sale, owing nothing', () => {
    addJioLineAndCredit();
    counter.chooseCustomer(creditCustomer({ outstanding: 0, advanceHeld: 500, warn: false }));
    fixture.detectChanges();
    expect(counter.willOweAfterThis).toBe(0);
    expect(counter.advanceLeftAfterThis).toBe(201); // 500 - 299
  });

  it('takes the credit amount from the typed row when the payment is split', () => {
    addJioLine();
    counter.toggleMethod('CREDIT');
    counter.line('CASH')!.amount = 100;
    counter.line('CREDIT')!.amount = 199;
    counter.chooseCustomer(creditCustomer());
    expect(counter.creditAmount).toBe(199);
    expect(counter.willOweAfterThis).toBe(539);     // 340 + 199
  });

  // -- adding a customer who is not in the book --------------------------

  it('offers a way to add a walk-in who is not in the book', () => {
    addJioLineAndCredit();
    counter.onCustomerQuery('zzzz');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Not in the book');
  });

  it('seeds the new-customer form from whatever was typed', () => {
    addJioLineAndCredit();
    counter.customerQuery = 'Sunita';
    counter.startAddingCustomer();
    expect(counter.newCustomer.firstName).toBe('Sunita');

    counter.customerQuery = '9876543210';
    counter.startAddingCustomer();
    expect(counter.newCustomer.mobile).toBe('9876543210');
    expect(counter.newCustomer.firstName).toBe('');
  });

  it('will not save without a first name and a ten-digit mobile', () => {
    addJioLineAndCredit();
    counter.startAddingCustomer();
    counter.newCustomer = { firstName: '', lastName: '', mobile: '9876543210' };
    expect(counter.canCreateCustomer).toBe(false);
    counter.newCustomer = { firstName: 'Sunita', lastName: '', mobile: '98765' };
    expect(counter.canCreateCustomer).toBe(false);
    counter.newCustomer = { firstName: 'Sunita', lastName: '', mobile: '9876543210' };
    expect(counter.canCreateCustomer).toBe(true);
  });

  it('omits a blank last name rather than sending an empty string', () => {
    addJioLineAndCredit();
    counter.startAddingCustomer();
    counter.newCustomer = { firstName: 'Sunita', lastName: '  ', mobile: '9876543210' };
    counter.createCustomer();
    const request = http.expectOne(`${base}/customers`);
    expect(request.request.body).toEqual({ firstName: 'Sunita', mobile: '9876543210' });
    request.flush(creditCustomer({ customerId: 900, name: 'Sunita', outstanding: 0, warn: false }));
  });

  it('uses a newly created customer straight away', () => {
    addJioLineAndCredit();
    counter.startAddingCustomer();
    counter.newCustomer = { firstName: 'Sunita', lastName: 'Rao', mobile: '9876543210' };
    counter.createCustomer();
    http.expectOne(`${base}/customers`).flush(
      creditCustomer({ customerId: 900, name: 'Sunita Rao', contactNumber: '9876543210',
                       outstanding: 0, oldestDebtDays: null, warn: false }));
    expect(counter.line('CREDIT')!.customer!.customerId).toBe(900);
    expect(counter.addingCustomer).toBe(false);
    expect(counter.canTakePayment).toBe(true);
  });

  /**
   * ⚠ A duplicate mobile answers 409 with the EXISTING customer rather than an error
   * body — the one response on this surface that breaks the single error shape.
   */
  it('offers the existing customer when the mobile is already taken', () => {
    addJioLineAndCredit();
    counter.startAddingCustomer();
    counter.newCustomer = { firstName: 'Sunita', lastName: '', mobile: '9960448201' };
    counter.createCustomer();
    http.expectOne(`${base}/customers`).flush(
      { existingCustomerId: 403, name: 'Ramesh Pawar', contactNumber: '9960448201' },
      { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(counter.existingCustomer!.existingCustomerId).toBe(403);
    expect(counter.createCustomerError).toBe('');
    expect(fixture.nativeElement.textContent).toContain('already has that mobile');
  });

  it('reads the existing customer back rather than assuming they owe nothing', () => {
    addJioLineAndCredit();
    counter.startAddingCustomer();
    counter.newCustomer = { firstName: 'Sunita', lastName: '', mobile: '9960448201' };
    counter.createCustomer();
    http.expectOne(`${base}/customers`).flush(
      { existingCustomerId: 403, name: 'Ramesh Pawar', contactNumber: '9960448201' },
      { status: 409, statusText: 'Conflict' });

    counter.useExistingCustomer();
    const lookup = http.expectOne((r) => r.url === `${base}/customers` && r.method === 'GET');
    expect(lookup.request.params.get('query')).toBe('9960448201');
    lookup.flush([creditCustomer()]);

    // The real figures, not zeroes.
    expect(counter.line('CREDIT')!.customer!.outstanding).toBe(340);
    expect(counter.line('CREDIT')!.customer!.warn).toBe(true);
  });

  it('reports an ordinary failure to create rather than treating it as a duplicate', () => {
    addJioLineAndCredit();
    counter.startAddingCustomer();
    counter.newCustomer = { firstName: 'Sunita', lastName: '', mobile: '9876543210' };
    counter.createCustomer();
    http.expectOne(`${base}/customers`).flush(
      { code: 'INVALID_REQUEST', message: 'A mobile number is 10 digits.', traceId: 'a' },
      { status: 400, statusText: 'Bad Request' });
    expect(counter.existingCustomer).toBeNull();
    expect(counter.createCustomerError).toBe('A mobile number is 10 digits.');
  });

  // ---------------------------------------------------------------- TV entry

  it('offers a way in for a box that is not in the connection table', () => {
    counter.chooseService('TV');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Not in the list');
    counter.enterConnectionByHand();
    fixture.detectChanges();
    expect(counter.tvMode).toBe('manual');
    expect(fixture.nativeElement.querySelector('#counter-number')).toBeTruthy();
  });

  it('takes the operator from a chosen connection rather than asking twice', () => {
    counter.chooseService('TV');
    counter.chooseConnection({
      connectionNumber: '02700431198',
      operatorCode: 'DISHTV',
      name: 'S. R. Kulkarni',
      contactNumber: '9881203114'
    });
    fixture.detectChanges();
    expect(counter.numberText).toBe('02700431198');
    expect(counter.operatorCode).toBe('DISHTV');
    expect(fixture.nativeElement.querySelector('.chip-operator')).toBeNull();
  });
});
