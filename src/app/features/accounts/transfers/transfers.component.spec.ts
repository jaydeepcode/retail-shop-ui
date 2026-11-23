import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../../environments/environment';
import { AccountResponse, SharedConfigResponse, VoucherResponse } from '../model/accounts.models';
import { TransfersComponent } from './transfers.component';

const base = environment.apiUrl;

function account(overrides: Partial<AccountResponse>): AccountResponse {
  return {
    accountCode: 'X',
    displayName: 'X',
    accountType: 'ASSET',
    businessCode: 'SHARED',
    reportGroup: 'CASH_AND_BANK',
    cashPool: null,
    isPoolPrimary: false,
    allowManual: true,
    requiresParty: false,
    reconcilable: true,
    floatPattern: null,
    sortOrder: 0,
    ...overrides
  };
}

/** V21's actual seed, trimmed to what this screen's pickers care about. */
function accountsResponse(): AccountResponse[] {
  return [
    account({ accountCode: 'CASH_WATER', displayName: 'Cash-Water', sortOrder: 100 }),
    account({ accountCode: 'CASH_RECHARGE', displayName: 'Cash-Recharge', sortOrder: 110 }),
    account({ accountCode: 'CASH_TICKET', displayName: 'Cash-Ticket', sortOrder: 120 }),
    account({ accountCode: 'CASH_SAFE', displayName: 'Cash-Safe', sortOrder: 125 }),
    account({ accountCode: 'BANK_JANATA', displayName: 'Janata Sahakari Bank', sortOrder: 130 }),
    account({ accountCode: 'BANK_SELF', displayName: 'Bank-Self', sortOrder: 140 }),
    account({ accountCode: 'BANK_WIFE', displayName: 'Bank-Wife', sortOrder: 150 }),
    account({ accountCode: 'BANK_FATHER', displayName: 'Bank-Father (SBI)', sortOrder: 155 }),
    account({
      accountCode: 'UPI_CLEARING',
      displayName: 'UPI Clearing',
      allowManual: false,
      sortOrder: 160
    }),
    account({
      accountCode: 'FLOAT_ARTL',
      displayName: 'Airtel Float',
      reportGroup: 'FLOAT',
      allowManual: false,
      floatPattern: 'TXN_RATE',
      sortOrder: 900
    }),
    account({
      accountCode: 'FLOAT_RJIO',
      displayName: 'Jio Float',
      reportGroup: 'FLOAT',
      allowManual: false,
      floatPattern: 'TXN_RATE',
      sortOrder: 910
    }),
    account({
      accountCode: 'FLOAT_VI',
      displayName: 'Vi Float',
      reportGroup: 'FLOAT',
      allowManual: false,
      floatPattern: 'TXN_RATE',
      sortOrder: 920
    }),
    account({
      accountCode: 'FLOAT_A1TOPUP',
      displayName: 'A1Topup Float',
      reportGroup: 'FLOAT',
      allowManual: false,
      floatPattern: 'TXN_RATE',
      sortOrder: 930
    })
  ];
}

function config(overrides: Partial<SharedConfigResponse> = {}): SharedConfigResponse {
  return { changeDisplayThreshold: 5, floatImpsFee: 5, ...overrides };
}

function voucher(overrides: Partial<VoucherResponse> = {}): VoucherResponse {
  return {
    voucherId: 8101,
    voucherType: 'CONTRA',
    voucherDate: '2026-10-07',
    voucherDttm: '2026-10-07T20:40:00',
    narration: 'Weekly deposit, Janata counter',
    sourceType: null,
    sourceRef: null,
    reversesVoucherId: null,
    sealedAt: '2026-10-07T20:40:00',
    legs: [
      { lineNo: 1, accountCode: 'BANK_JANATA', dr: 5000, cr: 0, partyCustId: null, paymentMethod: null, lineNarration: null },
      { lineNo: 2, accountCode: 'CASH_SAFE', dr: 0, cr: 5000, partyCustId: null, paymentMethod: null, lineNarration: null }
    ],
    replayed: false,
    ...overrides
  };
}

describe('TransfersComponent', () => {
  let fixture: ComponentFixture<TransfersComponent>;
  let transfers: TransfersComponent;
  let http: HttpTestingController;

  function open(accounts = accountsResponse(), cfg = config()): void {
    fixture.detectChanges();
    http.expectOne(`${base}/accounts`).flush(accounts);
    http.expectOne(`${base}/config`).flush(cfg);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule],
      declarations: [TransfersComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(TransfersComponent);
    transfers = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // -- The pickers, all from endpoint 12 -------------------------------------

  it('drops the two tills from the contra picker, keeping the safe, the water drawer and the four banks', () => {
    open();
    const codes = transfers.contraAccounts.map((a) => a.accountCode);
    expect(codes).toEqual(['CASH_WATER', 'CASH_SAFE', 'BANK_JANATA', 'BANK_SELF', 'BANK_WIFE', 'BANK_FATHER']);
  });

  it('offers the four FLOAT_* accounts by floatPattern, never by a hardcoded code list', () => {
    open();
    const codes = transfers.floatAccounts.map((a) => a.accountCode);
    expect(codes).toEqual(['FLOAT_ARTL', 'FLOAT_RJIO', 'FLOAT_VI', 'FLOAT_A1TOPUP']);
  });

  it('drops all three tills from the top-up\'s paid-from picker, leaving the safe and the banks', () => {
    open();
    const codes = transfers.paidFromAccounts.map((a) => a.accountCode);
    expect(codes).toEqual(['CASH_SAFE', 'BANK_JANATA', 'BANK_SELF', 'BANK_WIFE', 'BANK_FATHER']);
  });

  it('never offers the same account on both ends of a contra', () => {
    open();
    transfers.contraFrom = 'CASH_SAFE';
    expect(transfers.contraToOptions.some((a) => a.accountCode === 'CASH_SAFE')).toBe(false);
  });

  // -- The contra, endpoint 8 -------------------------------------------------

  it('sends a client-generated Idempotency-Key and the two-leg request', () => {
    open();
    transfers.contraFrom = 'CASH_SAFE';
    transfers.contraTo = 'BANK_JANATA';
    transfers.contraAmountInput = '5,000';
    transfers.contraDateInput = '2026-10-07';
    transfers.contraNarration = 'Weekly deposit, Janata counter';
    transfers.submitContra();

    const request = http.expectOne(`${base}/vouchers/contras`);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Idempotency-Key')).toBeTruthy();
    expect(request.request.body).toEqual({
      voucherDate: '2026-10-07',
      fromAccountCode: 'CASH_SAFE',
      toAccountCode: 'BANK_JANATA',
      amount: 5000,
      narration: 'Weekly deposit, Janata counter'
    });
    request.flush(voucher(), { status: 201, statusText: 'Created' });
  });

  it('shows ₹0.00 reaching profit or loss, always, for a contra', () => {
    open();
    transfers.contraFrom = 'CASH_SAFE';
    transfers.contraTo = 'BANK_JANATA';
    transfers.contraAmountInput = '5,000';
    fixture.detectChanges();

    expect(text()).toContain('Reaching profit or loss');
    expect(text()).toContain('₹0.00');
  });

  it('refuses, client-side, a date in the future', () => {
    open();
    transfers.contraDateInput = farFutureIso();
    expect(transfers.contraDateInFuture).toBe(true);
    expect(transfers.canSubmitContra).toBe(false);
  });

  it('treats a 409 on the contra as the answer it carries, mints a fresh key, and clears the form', () => {
    open();
    transfers.contraFrom = 'CASH_SAFE';
    transfers.contraTo = 'BANK_JANATA';
    transfers.contraAmountInput = '5,000';
    transfers.submitContra();

    const first = http.expectOne(`${base}/vouchers/contras`);
    const firstKey = first.request.headers.get('Idempotency-Key');
    first.flush(voucher({ replayed: true }), { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(transfers.contraError).toBe('');
    expect(transfers.contraResult?.replayed).toBe(true);
    expect(text()).toContain('Already recorded');

    transfers.contraAmountInput = '1,000';
    transfers.submitContra();
    const second = http.expectOne(`${base}/vouchers/contras`);
    expect(second.request.headers.get('Idempotency-Key')).not.toBe(firstKey);
    second.flush(voucher({ voucherId: 8102 }), { status: 201, statusText: 'Created' });
  });

  it('shows the server\'s sentence on a refusal, and keeps the same key for the retry', () => {
    open();
    transfers.contraFrom = 'CASH_SAFE';
    transfers.contraTo = 'BANK_JANATA';
    transfers.contraAmountInput = '5,000';
    transfers.submitContra();

    const first = http.expectOne(`${base}/vouchers/contras`);
    const firstKey = first.request.headers.get('Idempotency-Key');
    first.flush(
      { code: 'LEDGER_POSTING_REFUSED', message: 'account is not active: CASH_SAFE' },
      { status: 422, statusText: 'Unprocessable Entity' }
    );
    fixture.detectChanges();

    expect(transfers.contraError).toBe('account is not active: CASH_SAFE');
    expect(transfers.contraResult).toBeNull();

    transfers.submitContra();
    const second = http.expectOne(`${base}/vouchers/contras`);
    expect(second.request.headers.get('Idempotency-Key')).toBe(firstKey);
    second.flush(voucher(), { status: 201, statusText: 'Created' });
  });

  // -- The top-up, endpoint 19 -------------------------------------------------

  it('defaults the transfer fee from GET /config, never a literal', () => {
    open(accountsResponse(), config({ floatImpsFee: 5 }));
    transfers.topupPaidFrom = 'BANK_JANATA';
    expect(transfers.topupFee).toBe(5);
  });

  it('sends transferFee: 0 for a cash top-up, rather than omitting it', () => {
    open();
    transfers.topupFloatAccount = 'FLOAT_A1TOPUP';
    transfers.topupAmountInput = '10,000';
    transfers.topupDateInput = '2026-10-04';
    transfers.chooseTopupPaidFrom('CASH_SAFE');
    fixture.detectChanges();

    expect(transfers.topupIsCash).toBe(true);
    expect(transfers.topupFee).toBe(0);

    transfers.submitTopup();
    const request = http.expectOne(`${base}/vouchers/purchases`);
    expect(request.request.body).toEqual({
      voucherDate: '2026-10-04',
      floatAccountCode: 'FLOAT_A1TOPUP',
      amount: 10000,
      sourceAccountCode: 'CASH_SAFE',
      transferFee: 0
    });
    request.flush(
      voucher({
        voucherId: 9201,
        voucherType: 'PURCHASE',
        legs: [
          { lineNo: 1, accountCode: 'FLOAT_A1TOPUP', dr: 10000, cr: 0, partyCustId: null, paymentMethod: null, lineNarration: null },
          { lineNo: 2, accountCode: 'CASH_SAFE', dr: 0, cr: 10000, partyCustId: null, paymentMethod: null, lineNarration: null }
        ]
      }),
      { status: 201, statusText: 'Created' }
    );
  });

  it('sends the config fee as its own leg when paying from a bank', () => {
    open(accountsResponse(), config({ floatImpsFee: 5 }));
    transfers.topupFloatAccount = 'FLOAT_A1TOPUP';
    transfers.topupAmountInput = '10,000';
    transfers.topupDateInput = '2026-10-04';
    transfers.chooseTopupPaidFrom('BANK_JANATA');
    transfers.submitTopup();

    const request = http.expectOne(`${base}/vouchers/purchases`);
    expect(request.request.body).toEqual({
      voucherDate: '2026-10-04',
      floatAccountCode: 'FLOAT_A1TOPUP',
      amount: 10000,
      sourceAccountCode: 'BANK_JANATA',
      transferFee: 5
    });
    request.flush(voucher({ voucherId: 9202, voucherType: 'PURCHASE' }), { status: 201, statusText: 'Created' });
  });

  it('cannot submit the top-up while the fee is unknown', () => {
    open(accountsResponse(), config());
    // Config failed to load — no fallback.
    transfers.floatImpsFee = null;
    transfers.topupFloatAccount = 'FLOAT_A1TOPUP';
    transfers.topupAmountInput = '10,000';
    transfers.chooseTopupPaidFrom('BANK_JANATA');

    expect(transfers.canSubmitTopup).toBe(false);
  });

  it('treats a 409 on the top-up as the answer it carries and mints a fresh key', () => {
    open();
    transfers.topupFloatAccount = 'FLOAT_A1TOPUP';
    transfers.topupAmountInput = '10,000';
    transfers.chooseTopupPaidFrom('CASH_SAFE');
    transfers.submitTopup();

    const first = http.expectOne(`${base}/vouchers/purchases`);
    const firstKey = first.request.headers.get('Idempotency-Key');
    first.flush(
      voucher({ voucherId: 9201, voucherType: 'PURCHASE', replayed: true }),
      { status: 409, statusText: 'Conflict' }
    );
    fixture.detectChanges();

    expect(transfers.topupError).toBe('');
    expect(transfers.topupResult?.replayed).toBe(true);
    expect(text()).toContain('Already recorded');

    transfers.topupAmountInput = '2,000';
    transfers.submitTopup();
    const second = http.expectOne(`${base}/vouchers/purchases`);
    expect(second.request.headers.get('Idempotency-Key')).not.toBe(firstKey);
    second.flush(voucher({ voucherId: 9203, voucherType: 'PURCHASE' }), { status: 201, statusText: 'Created' });
  });
});

function farFutureIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + 3);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
