import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../../environments/environment';
import { AccountResponse, VoucherResponse } from '../model/accounts.models';
import { ExpensesComponent } from './expenses.component';

const base = environment.apiUrl;

function todayIso(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function account(overrides: Partial<AccountResponse>): AccountResponse {
  return {
    accountCode: 'EXP_ELEC_WATER',
    displayName: 'Electricity – Water',
    accountType: 'EXPENSE',
    businessCode: 'SHARED',
    reportGroup: 'EXPENSE',
    cashPool: null,
    isPoolPrimary: false,
    allowManual: true,
    requiresParty: false,
    reconcilable: false,
    floatPattern: null,
    sortOrder: 600,
    ...overrides
  };
}

/** The five seeded categories, artboard 14's own set. */
function categoryAccounts(): AccountResponse[] {
  return [
    account({ accountCode: 'EXP_ELEC_WATER', displayName: 'Electricity – Water', sortOrder: 600 }),
    account({ accountCode: 'EXP_MAINT_WATER', displayName: 'Maintenance – Water', sortOrder: 610 }),
    account({ accountCode: 'EXP_BANK_CHARGES', displayName: 'Bank Charges – Recharge', sortOrder: 620 }),
    account({ accountCode: 'EXP_RCHG_LOSS', displayName: 'Recharge Losses', sortOrder: 630 }),
    account({ accountCode: 'EXP_SUNDRY_SHOP', displayName: 'Sundry – Shop', sortOrder: 640 })
  ];
}

/** Endpoint 12's eight manual ASSET accounts — the two tills kept, CASH_TICKET included. */
function sourceAccounts(): AccountResponse[] {
  const base: Partial<AccountResponse> = { accountType: 'ASSET', reportGroup: 'CASH_AND_BANK' };
  return [
    account({ ...base, accountCode: 'CASH_SAFE', displayName: 'The safe', sortOrder: 100, cashPool: 'SAFE' }),
    account({ ...base, accountCode: 'CASH_WATER', displayName: 'Water drawer', sortOrder: 110, cashPool: 'POOL-2' }),
    account({ ...base, accountCode: 'CASH_RECHARGE', displayName: 'Recharge till', sortOrder: 120, cashPool: 'POOL-1', isPoolPrimary: true }),
    account({ ...base, accountCode: 'CASH_TICKET', displayName: 'Ticket till', sortOrder: 130, cashPool: 'POOL-1' }),
    account({ ...base, accountCode: 'BANK_JANATA', displayName: 'Janata Sahakari Bank', sortOrder: 140 }),
    account({ ...base, accountCode: 'BANK_SELF', displayName: 'Bank – Self', sortOrder: 150 }),
    account({ ...base, accountCode: 'BANK_WIFE', displayName: 'Bank – Wife', sortOrder: 160 }),
    account({ ...base, accountCode: 'BANK_FATHER', displayName: 'Bank – Father', sortOrder: 170 })
  ];
}

function voucherResponse(overrides: Partial<VoucherResponse> = {}): VoucherResponse {
  return {
    voucherId: 7001,
    voucherType: 'PAYMENT',
    voucherDate: todayIso(),
    voucherDttm: `${todayIso()}T10:00:00`,
    narration: 'MSEB bill, Sept',
    sourceType: null,
    sourceRef: null,
    reversesVoucherId: null,
    sealedAt: `${todayIso()}T10:00:00`,
    legs: [
      { lineNo: 1, accountCode: 'EXP_ELEC_WATER', dr: 1200, cr: 0, partyCustId: null, paymentMethod: null, lineNarration: null },
      { lineNo: 2, accountCode: 'CASH_SAFE', dr: 0, cr: 1200, partyCustId: null, paymentMethod: null, lineNarration: null }
    ],
    replayed: false,
    ...overrides
  };
}

describe('ExpensesComponent', () => {
  let fixture: ComponentFixture<ExpensesComponent>;
  let expenses: ExpensesComponent;
  let http: HttpTestingController;

  function open(categories = categoryAccounts(), sources = sourceAccounts()): void {
    fixture.detectChanges();
    http.expectOne(`${base}/accounts?manualOnly=true&type=EXPENSE`).flush(categories);
    http.expectOne(`${base}/accounts?manualOnly=true&type=ASSET`).flush(sources);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule],
      declarations: [ExpensesComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ExpensesComponent);
    expenses = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  // -- Loading, and the two filtered endpoint-12 calls -----------------------------------

  it('asks endpoint 12 for the five seeded categories and the manual ASSET accounts, never a hardcoded list', () => {
    open();
    expect(expenses.categoryAccounts.map((a) => a.accountCode)).toEqual([
      'EXP_ELEC_WATER',
      'EXP_MAINT_WATER',
      'EXP_BANK_CHARGES',
      'EXP_RCHG_LOSS',
      'EXP_SUNDRY_SHOP'
    ]);
  });

  it('drops CASH_TICKET client-side, and nothing else', () => {
    open();
    expect(expenses.sourceAccounts.map((a) => a.accountCode)).not.toContain('CASH_TICKET');
    expect(expenses.sourceAccounts.length).toBe(7);
  });

  it('defaults to the first category and the safe as the source', () => {
    open();
    expect(expenses.selectedCategoryKey).toBe('EXP_ELEC_WATER');
    expect(expenses.selectedSourceCode).toBe('CASH_SAFE');
  });

  it('shows only the safe and Janata as visible source chips until "Other source" is used', () => {
    open();
    expect(expenses.visibleSourceAccounts.map((a) => a.accountCode)).toEqual(['CASH_SAFE', 'BANK_JANATA']);
    expect(expenses.disclosableSourceAccounts.map((a) => a.accountCode)).toEqual([
      'CASH_WATER',
      'CASH_RECHARGE',
      'BANK_SELF',
      'BANK_WIFE',
      'BANK_FATHER'
    ]);
  });

  // -- "+ New category" is a label, never a new ledger account ---------------------------

  it('adds a typed category as a chip that still posts EXP_SUNDRY_SHOP underneath', () => {
    open();
    expenses.startAddingCategory();
    expenses.newCategoryInput = 'Pump repair';
    expenses.addCategory();

    expect(expenses.selectedCategoryKey).toBe('custom:pump repair');
    expect(expenses.selectedCategory?.accountCode).toBe('EXP_SUNDRY_SHOP');
    expect(expenses.selectedCategory?.suffix).toBe('Sundry');
  });

  it('shows the true account in the recorded preview, never the custom label', () => {
    open();
    expenses.startAddingCategory();
    expenses.newCategoryInput = 'Pump repair';
    expenses.addCategory();
    fixture.detectChanges();

    expect(expenses.selectedCategoryAccount?.displayName).toBe('Sundry – Shop');
    expect(text()).toContain('Into Sundry – Shop');
    expect(text()).not.toContain('Into Pump repair');
  });

  it('carries the typed label only in the narration, prefixed onto whatever else was typed', () => {
    open();
    expenses.startAddingCategory();
    expenses.newCategoryInput = 'Pump repair';
    expenses.addCategory();
    expenses.narration = 'paid the mechanic';

    expect(expenses.narrationToSend).toBe('Pump repair: paid the mechanic');
  });

  it('remembers a custom category across a reload, from localStorage', () => {
    open();
    expenses.startAddingCategory();
    expenses.newCategoryInput = 'Pump repair';
    expenses.addCategory();

    fixture = TestBed.createComponent(ExpensesComponent);
    expenses = fixture.componentInstance;
    open();

    expect(expenses.categoryChips.some((c) => c.label === 'Pump repair')).toBe(true);
  });

  // -- Picking a disclosed source promotes it, per category ------------------------------

  it('promotes a disclosed source to a visible chip for the selected category only', () => {
    open();
    expenses.selectSource('CASH_RECHARGE');

    expect(expenses.selectedSourceCode).toBe('CASH_RECHARGE');
    expect(expenses.visibleSourceAccounts.map((a) => a.accountCode)).toEqual([
      'CASH_SAFE',
      'BANK_JANATA',
      'CASH_RECHARGE'
    ]);

    // A different category never saw that promotion.
    expenses.selectCategory(expenses.categoryChips[1]);
    expect(expenses.visibleSourceAccounts.map((a) => a.accountCode)).toEqual(['CASH_SAFE', 'BANK_JANATA']);
  });

  it('falls back to a visible chip when switching to a category with nothing promoted', () => {
    open();
    expenses.selectSource('CASH_RECHARGE');
    expenses.selectCategory(expenses.categoryChips[1]);

    expect(expenses.selectedSourceCode).toBe('CASH_SAFE');
  });

  // -- Validation --------------------------------------------------------------------------

  it('requires an amount, a narration and a non-future date before it can submit', () => {
    open();
    expect(expenses.canSubmit).toBe(false);

    expenses.amountInput = '1,200';
    expenses.narration = 'MSEB bill, Sept';
    expect(expenses.canSubmit).toBe(true);

    expenses.dateInput = '2099-01-01';
    expect(expenses.dateInFuture).toBe(true);
    expect(expenses.canSubmit).toBe(false);
  });

  // -- The write, and its Idempotency-Key -------------------------------------------------

  it('sends a client-generated Idempotency-Key, with the true account code and the typed amount', () => {
    open();
    expenses.amountInput = '1,200';
    expenses.narration = 'MSEB bill, Sept';
    expenses.submit();

    const request = http.expectOne(`${base}/vouchers/payments`);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Idempotency-Key')).toBeTruthy();
    expect(request.request.body).toEqual({
      voucherDate: todayIso(),
      expenseAccountCode: 'EXP_ELEC_WATER',
      sourceAccountCode: 'CASH_SAFE',
      amount: 1200,
      narration: 'MSEB bill, Sept'
    });
    request.flush(voucherResponse(), { status: 201, statusText: 'Created' });
  });

  it('mints a fresh key after a successful post, and clears the amount and narration', () => {
    open();
    expenses.amountInput = '1,200';
    expenses.narration = 'MSEB bill, Sept';
    expenses.submit();

    const first = http.expectOne(`${base}/vouchers/payments`);
    const firstKey = first.request.headers.get('Idempotency-Key');
    first.flush(voucherResponse(), { status: 201, statusText: 'Created' });
    fixture.detectChanges();

    expect(expenses.result?.voucherId).toBe(7001);
    expect(expenses.amountInput).toBe('');
    expect(expenses.narration).toBe('');

    expenses.amountInput = '500';
    expenses.narration = 'second one';
    expenses.submit();
    const second = http.expectOne(`${base}/vouchers/payments`);
    expect(second.request.headers.get('Idempotency-Key')).not.toBe(firstKey);
    second.flush(voucherResponse({ voucherId: 7002 }), { status: 201, statusText: 'Created' });
  });

  it('treats a 409 as the answer it carries, not as a failure', () => {
    open();
    expenses.amountInput = '1,200';
    expenses.narration = 'MSEB bill, Sept';
    expenses.submit();

    http.expectOne(`${base}/vouchers/payments`).flush(voucherResponse({ replayed: true }), {
      status: 409,
      statusText: 'Conflict'
    });
    fixture.detectChanges();

    expect(expenses.submitError).toBe('');
    expect(expenses.result?.replayed).toBe(true);
    expect(text()).toContain('Already recorded');
  });

  it('shows the server’s sentence on a refusal, and keeps the same key for the retry', () => {
    open();
    expenses.amountInput = '1,200';
    expenses.narration = 'MSEB bill, Sept';
    expenses.submit();

    const first = http.expectOne(`${base}/vouchers/payments`);
    const firstKey = first.request.headers.get('Idempotency-Key');
    first.flush(
      { code: 'LEDGER_POSTING_REFUSED', message: 'account is not active: EXP_ELEC_WATER' },
      { status: 422, statusText: 'Unprocessable Entity' }
    );
    fixture.detectChanges();

    expect(expenses.submitError).toBe('account is not active: EXP_ELEC_WATER');

    expenses.submit();
    const second = http.expectOne(`${base}/vouchers/payments`);
    expect(second.request.headers.get('Idempotency-Key')).toBe(firstKey);
    second.flush(voucherResponse(), { status: 201, statusText: 'Created' });
  });
});
