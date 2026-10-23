import { of, throwError } from 'rxjs';
import { CreateCustomerRequest, CreditCustomerResponse } from './payment.models';
import { allocated, CustomerDirectory, num, PaymentLine, Tender, toSettlementLines } from './tender';

const RAMESH: CreditCustomerResponse = {
  customerId: 403,
  name: 'Ramesh Pawar',
  contactNumber: '9960448201',
  outstanding: 340,
  advanceHeld: 0,
  oldestDebtDays: 54,
  warn: true
};

/**
 * The tender half, which `basket.spec.ts` used to hold. Everything above the `Tender`
 * describes came across with the code it covers, assertion for assertion.
 */
describe('toSettlementLines', () => {
  it('puts amountTendered on cash only', () => {
    const lines: PaymentLine[] = [
      { method: 'CASH', amount: 300, amountTendered: 500 },
      { method: 'UPI', amount: 100, amountTendered: 999 as unknown as number }
    ];
    const [cash, upi] = toSettlementLines(lines);
    expect(cash.amountTendered).toBe(500);
    expect('amountTendered' in upi).toBe(false);
  });

  it('requires a customer id on a credit line and carries the note', () => {
    const lines: PaymentLine[] = [
      {
        method: 'CREDIT',
        amount: 49,
        note: 'will pay Friday',
        customer: {
          customerId: 403,
          name: 'R. Pawar',
          contactNumber: '9960448201',
          outstanding: 340,
          advanceHeld: 0,
          oldestDebtDays: 54,
          warn: true
        }
      }
    ];
    const [credit] = toSettlementLines(lines);
    expect(credit.customerId).toBe(403);
    expect(credit.note).toBe('will pay Friday');
  });

  it('allocates across payment lines', () => {
    expect(allocated([
      { method: 'CASH', amount: 300 },
      { method: 'UPI', amount: 100 },
      { method: 'CREDIT', amount: 49 }
    ])).toBe(449);
  });
});

/**
 * ⚠ REGRESSION. `[(ngModel)]` on a text input writes back a STRING, so a typed split
 * sent `{"amount":"100"}` and `{"amount":"199"}`. The screen's own "left to allocate"
 * read ₹0.00 because JavaScript coerces for `*`, and the server then refused the basket
 * with `providedTotal: 100199` — string concatenation. Found by clicking through it,
 * invisible to every test that set the amounts as numbers.
 */
describe('figures typed into a text input arrive as strings', () => {
  it('sends amounts as JSON numbers, not as the strings ngModel wrote', () => {
    const lines: PaymentLine[] = [
      { method: 'CASH', amount: '100', amountTendered: '100' },
      { method: 'CREDIT', amount: '199', customer: {
        customerId: 512, name: 'Anil Pawar', contactNumber: '9823551740',
        outstanding: 49, advanceHeld: 0, oldestDebtDays: 6, warn: false } }
    ];
    const [cash, credit] = toSettlementLines(lines);
    expect(cash.amount).toBe(100);
    expect(cash.amountTendered).toBe(100);
    expect(credit.amount).toBe(199);
    expect(typeof credit.amount).toBe('number');
  });

  it('adds string amounts rather than concatenating them', () => {
    expect(allocated([
      { method: 'CASH', amount: '100' },
      { method: 'CREDIT', amount: '199' }
    ])).toBe(299);
  });

  it('leaves an untyped tender off the request rather than sending an empty string', () => {
    const [cash] = toSettlementLines([{ method: 'CASH', amount: '299', amountTendered: '' }]);
    expect('amountTendered' in cash).toBe(false);
  });

  it('reads a blank or unparseable figure as zero', () => {
    expect(num('')).toBe(0);
    expect(num('   ')).toBe(0);
    expect(num('abc')).toBe(0);
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num('199')).toBe(199);
    expect(num(' 199.50 ')).toBe(199.5);
    expect(num(199)).toBe(199);
  });
});

/**
 * The class itself, against no screen at all.
 *
 * `counter.component.spec.ts` already asserts these rules through the counter and is the
 * guard that the extraction changed nothing. These are here because the ticket screen is
 * the second caller and will not re-test what it inherits — a rule that only holds while
 * a recharge basket is on screen is not a rule the ticket screen can rely on.
 */
describe('Tender', () => {
  let directory: jasmine.SpyObj<CustomerDirectory>;
  let total: number;
  let threshold: number;
  let edits: number;
  let tender: Tender;

  beforeEach(() => {
    directory = jasmine.createSpyObj<CustomerDirectory>('CustomerDirectory', [
      'searchCustomers',
      'createCustomer'
    ]);
    total = 485;
    threshold = 5;
    edits = 0;
    tender = new Tender({
      directory,
      totalToMatch: () => total,
      changeThreshold: () => threshold,
      onEdit: () => (edits += 1),
      errorSentence: () => 'That did not work.',
      asExistingCustomer: () => null
    });
  });

  afterEach(() => tender.destroy());

  it('starts on one cash line, so splitting is opt-in', () => {
    expect(tender.lines.length).toBe(1);
    expect(tender.lines[0].method).toBe('CASH');
    expect(tender.isSingleMethod).toBe(true);
  });

  it('refuses to drop the last line', () => {
    tender.toggleMethod('CASH');
    expect(tender.lines.length).toBe(1);
  });

  it('caps a payment at five lines and says so', () => {
    // Four more alongside the opening cash line, and none of them CREDIT — toggling a
    // method that is already on takes its row away instead of reaching the cap.
    tender.lines.push(
      { method: 'UPI', amount: null },
      { method: 'UPI', amount: null },
      { method: 'UPI', amount: null },
      { method: 'UPI', amount: null }
    );
    tender.toggleMethod('CREDIT');
    expect(tender.lines.length).toBe(5);
    expect(tender.error).toBe('A payment takes at most 5 lines.');
  });

  it('tells the host the tender changed, so a stale refusal can be dropped', () => {
    tender.toggleMethod('UPI');
    expect(edits).toBe(1);
  });

  /**
   * ⚠ The total is read through a function, not copied. The counter's basket changes
   * while the panel is on screen; a copied figure would be a second opinion about what
   * the lines have to add up to.
   */
  it('follows the total the host supplies as it changes', () => {
    expect(tender.cashLineOf(tender.lines[0])).toBe(485);
    total = 60;
    expect(tender.cashLineOf(tender.lines[0])).toBe(60);
  });

  it('the single line carries the whole total without being typed', () => {
    const [line] = tender.settlementLines();
    expect(line.amount).toBe(485);
    // Nothing typed into the cash box means they gave the exact money.
    expect(line.amountTendered).toBe(485);
  });

  it('refuses a split that does not add up, and allows one that does', () => {
    tender.toggleMethod('UPI');
    tender.line('CASH')!.amount = '100';
    tender.line('UPI')!.amount = '100';
    expect(tender.leftToAllocate).toBe(285);
    expect(tender.isReady).toBe(false);

    tender.line('UPI')!.amount = '385';
    expect(tender.leftToAllocate).toBe(0);
    expect(tender.isReady).toBe(true);
  });

  it('will not settle credit without a named customer', () => {
    tender.toggleMethod('CREDIT');
    tender.line('CASH')!.amount = '400';
    tender.line('CREDIT')!.amount = '85';
    expect(tender.isReady).toBe(false);

    tender.chooseCustomer(RAMESH);
    expect(tender.isReady).toBe(true);
  });

  it('catches a tender below its own cash line before the server refuses it', () => {
    tender.toggleMethod('UPI');
    tender.line('CASH')!.amount = '200';
    tender.line('CASH')!.amountTendered = '100';
    tender.line('UPI')!.amount = '285';
    expect(tender.tenderIsShort(tender.line('CASH')!)).toBe(true);
    expect(tender.leftToAllocate).toBe(0);
    expect(tender.isReady).toBe(false);
  });

  /** §14.5: a rupee is not change — nobody hands it over. */
  it('keeps change below the threshold off the screen', () => {
    tender.toggleMethod('UPI');
    tender.line('CASH')!.amount = '100';
    tender.line('CASH')!.amountTendered = '101';
    expect(tender.provisionalChange(tender.line('CASH')!)).toBeNull();

    tender.line('CASH')!.amountTendered = '500';
    expect(tender.provisionalChange(tender.line('CASH')!)).toBe(400);
  });

  it('spends an advance before creating debt, matching what the server will do', () => {
    tender.toggleMethod('CREDIT');
    tender.chooseCustomer({ ...RAMESH, outstanding: 340, advanceHeld: 100 });
    tender.line('CASH')!.amount = '385';
    tender.line('CREDIT')!.amount = '100';
    expect(tender.creditAmount).toBe(100);
    expect(tender.willOweAfterThis).toBe(340);
    expect(tender.advanceLeftAfterThis).toBe(0);
  });

  it('seeds the new-customer form from whatever was typed', () => {
    tender.customerQuery = 'Sunita';
    tender.startAddingCustomer();
    expect(tender.newCustomer.firstName).toBe('Sunita');

    tender.customerQuery = '9876543210';
    tender.startAddingCustomer();
    expect(tender.newCustomer.mobile).toBe('9876543210');
    expect(tender.newCustomer.firstName).toBe('');
  });

  it('omits a blank last name rather than sending an empty string', () => {
    directory.createCustomer.and.returnValue(of(RAMESH));
    tender.toggleMethod('CREDIT');
    tender.newCustomer = { firstName: 'Sunita', lastName: '  ', mobile: '9876543210' };
    tender.createCustomer();
    const request = directory.createCustomer.calls.mostRecent().args[0] as CreateCustomerRequest;
    expect('lastName' in request).toBe(false);
    expect(tender.line('CREDIT')!.customer).toBe(RAMESH);
  });

  it('reports an ordinary failure to create rather than treating it as a duplicate', () => {
    directory.createCustomer.and.returnValue(throwError(() => new Error('boom')));
    tender.newCustomer = { firstName: 'Sunita', lastName: '', mobile: '9876543210' };
    tender.createCustomer();
    expect(tender.createCustomerError).toBe('That did not work.');
    expect(tender.existingCustomer).toBeNull();
  });

  /**
   * ⚠ A DEFECT FOUND BY THE EXTRACTION, and a deliberate change rather than a faithful
   * move. The counter's `startFresh` only replaced the payment lines, so an abandoned
   * "Not in the book — add them" form survived the sale: take one credit sale, open the
   * form, settle as cash instead, and the next customer's credit panel opens with the
   * previous walk-in's half-typed name in it. Nothing asserted it either way.
   */
  it('clears an abandoned new-customer form when the next sale starts', () => {
    tender.toggleMethod('CREDIT');
    tender.customerQuery = 'Sun';
    tender.startAddingCustomer();
    expect(tender.addingCustomer).toBe(true);

    tender.reset();
    expect(tender.addingCustomer).toBe(false);
    expect(tender.newCustomer.firstName).toBe('');
    expect(tender.customerQuery).toBe('');
    expect(tender.lines.length).toBe(1);
    expect(tender.lines[0].method).toBe('CASH');
  });
});
