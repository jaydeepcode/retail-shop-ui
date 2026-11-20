import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../../environments/environment';
import { ReconciliationResponse, UpiPendingResponse, UpiSettlementResponse } from '../model/accounts.models';
import { UpiComponent } from './upi.component';

const base = environment.apiUrl;

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Artboard 10's own figures: a fresh date one day old with nothing settled yet, and an
 * older date seven days old that is already partly settled — ₹3,450 collected, ₹3,200
 * settled, ₹250 still to come.
 */
function pendingResponse(overrides: Partial<UpiPendingResponse> = {}): UpiPendingResponse {
  return {
    asOf: isoDaysAgo(0),
    totalPending: 1700,
    dates: [
      {
        collectionDate: isoDaysAgo(7),
        collectedAmount: 3450,
        settledAmount: 3200,
        pendingAmount: 250,
        ageDays: 7
      },
      {
        collectionDate: isoDaysAgo(1),
        collectedAmount: 1450,
        settledAmount: 0,
        pendingAmount: 1450,
        ageDays: 1
      }
    ],
    ...overrides
  };
}

function reconciliation(overrides: Partial<ReconciliationResponse> = {}): ReconciliationResponse {
  return {
    reconId: 501,
    accountCode: 'UPI_CLEARING',
    reconDate: isoDaysAgo(7),
    countedAmount: 3450,
    ledgerAmount: 3450,
    varianceAmount: 0,
    faceCounted: null,
    faceLedger: null,
    note: null,
    varianceVoucherId: null,
    closedAt: `${isoDaysAgo(0)}T09:00:00`,
    ...overrides
  };
}

function settlementResponse(overrides: Partial<UpiSettlementResponse> = {}): UpiSettlementResponse {
  return {
    collectionDate: isoDaysAgo(7),
    settledOn: isoDaysAgo(0),
    settledAmount: 250,
    collectedAmount: 3450,
    settledToDate: 3450,
    residualAmount: 0,
    sequence: `UPI_SETTLEMENT:${isoDaysAgo(7)}:2`,
    bankAccountCode: 'BANK_JANATA',
    voucherId: 9101,
    reconciliation: reconciliation(),
    replayed: false,
    ...overrides
  };
}

describe('UpiComponent', () => {
  let fixture: ComponentFixture<UpiComponent>;
  let upi: UpiComponent;
  let http: HttpTestingController;

  function open(body = pendingResponse()): void {
    fixture.detectChanges();
    http.expectOne(`${base}/accounts/upi-clearing/pending`).flush(body);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule],
      declarations: [UpiComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UpiComponent);
    upi = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // -- The default selection -------------------------------------------------

  it('selects the oldest pending date by default, never the newest', () => {
    open();
    expect(upi.selectedDate).toBe(isoDaysAgo(7));
    expect(upi.amountInput).toBe('250');
    expect(upi.settledOnInput).toBe(isoDaysAgo(0));
  });

  it('shows nothing still on its way once every date is fully settled', () => {
    open(pendingResponse({ totalPending: 0, dates: [] }));
    expect(upi.selected).toBeNull();
    expect(text()).toContain('Nothing still on its way');
  });

  it('prefills the full pending amount on selection, resetting the date it landed to today', () => {
    open();
    upi.settledOnInput = isoDaysAgo(3);
    upi.select(upi.rows[1]);

    expect(upi.selectedDate).toBe(isoDaysAgo(1));
    expect(upi.amountInput).toBe('1,450');
    expect(upi.settledOnInput).toBe(isoDaysAgo(0));
  });

  // -- Settle what arrived, not what was expected ----------------------------

  it('reads "matches exactly" when the typed figure equals what is pending', () => {
    open();
    upi.amountInput = '250';
    fixture.detectChanges();

    expect(upi.matchesExactly).toBe(true);
    expect(upi.leftover).toBe(0);
    expect(text()).toContain('Matches exactly');
  });

  it('reads a residue when the typed figure is less, and does not call it an error', () => {
    open();
    upi.amountInput = '200';
    fixture.detectChanges();

    expect(upi.matchesExactly).toBe(false);
    expect(upi.leftover).toBe(50);
    expect(upi.canRecord).toBe(true);
    expect(text()).toContain('Leaves a residue');
  });

  it('compares in paise, so a figure that should match is not read as a residue', () => {
    open(pendingResponse({ dates: [{ ...pendingResponse().dates[0], pendingAmount: 0.07 }] }));
    upi.amountInput = '0.07';
    expect(upi.leftover).toBe(0);
    expect(upi.matchesExactly).toBe(true);
  });

  it('refuses, client-side, an amount greater than what is still pending for the date', () => {
    open();
    upi.amountInput = '300';
    fixture.detectChanges();

    expect(upi.amountTooHigh).toBe(true);
    expect(upi.canRecord).toBe(false);
    expect(text()).toContain('still pending for this date');
  });

  it('refuses a landing date before the collection date', () => {
    open();
    upi.settledOnInput = isoDaysAgo(8);
    expect(upi.settledOnBeforeCollection).toBe(true);
    expect(upi.canRecord).toBe(false);
  });

  it('refuses a landing date in the future', () => {
    open();
    upi.settledOnInput = isoDaysAgo(-1);
    expect(upi.settledOnInFuture).toBe(true);
    expect(upi.canRecord).toBe(false);
  });

  // -- The write, and its Idempotency-Key ------------------------------------

  it('sends an Idempotency-Key header, unlike the close screen’s two writes', () => {
    open();
    upi.record();

    const request = http.expectOne(`${base}/accounts/upi-clearing/settlements`);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Idempotency-Key')).toBeTruthy();
    expect(request.request.body).toEqual({
      collectionDate: isoDaysAgo(7),
      settledOn: isoDaysAgo(0),
      settledAmount: 250
    });
    request.flush(settlementResponse(), { status: 201, statusText: 'Created' });
    http.expectOne(`${base}/accounts/upi-clearing/pending`).flush(pendingResponse());
  });

  it('shows what was recorded, reloads what is pending, and mints a fresh key for the next one', () => {
    open();
    upi.record();

    const first = http.expectOne(`${base}/accounts/upi-clearing/settlements`);
    const firstKey = first.request.headers.get('Idempotency-Key');
    first.flush(settlementResponse(), { status: 201, statusText: 'Created' });

    // The settled date drops out of the pending list — a full settlement.
    http.expectOne(`${base}/accounts/upi-clearing/pending`).flush(
      pendingResponse({ totalPending: 1450, dates: [pendingResponse().dates[1]] })
    );
    fixture.detectChanges();

    expect(upi.recorded?.voucherId).toBe(9101);
    expect(upi.recorded?.replayed).toBe(false);
    expect(text()).toContain('Recorded for');
    expect(text()).toContain('BANK_JANATA');
    // The only remaining date takes over as the default, re-prefilled.
    expect(upi.selectedDate).toBe(isoDaysAgo(1));
    expect(upi.amountInput).toBe('1,450');

    upi.record();
    const second = http.expectOne(`${base}/accounts/upi-clearing/settlements`);
    expect(second.request.headers.get('Idempotency-Key')).not.toBe(firstKey);
    second.flush(settlementResponse({ collectionDate: isoDaysAgo(1) }), {
      status: 201,
      statusText: 'Created'
    });
    http.expectOne(`${base}/accounts/upi-clearing/pending`).flush(pendingResponse({ dates: [] }));
  });

  it('keeps a partly settled date selected, re-prefilled against the fresh residue', () => {
    open();
    upi.amountInput = '200';
    upi.record();

    const request = http.expectOne(`${base}/accounts/upi-clearing/settlements`);
    request.flush(
      settlementResponse({ settledAmount: 200, settledToDate: 3400, residualAmount: 50 }),
      { status: 201, statusText: 'Created' }
    );
    http.expectOne(`${base}/accounts/upi-clearing/pending`).flush(
      pendingResponse({
        dates: [
          { ...pendingResponse().dates[0], settledAmount: 3400, pendingAmount: 50 },
          pendingResponse().dates[1]
        ]
      })
    );
    fixture.detectChanges();

    // ⚠ Still the oldest date, with the residue it actually left — not the full ₹250
    // this screen started the test with.
    expect(upi.selectedDate).toBe(isoDaysAgo(7));
    expect(upi.amountInput).toBe('50');
  });

  it('treats a 409 as the answer it carries, not as a failure', () => {
    open();
    upi.record();

    http.expectOne(`${base}/accounts/upi-clearing/settlements`).flush(
      settlementResponse({ replayed: true }),
      { status: 409, statusText: 'Conflict' }
    );
    http.expectOne(`${base}/accounts/upi-clearing/pending`).flush(pendingResponse());
    fixture.detectChanges();

    expect(upi.recordError).toBe('');
    expect(upi.recorded?.replayed).toBe(true);
    expect(text()).toContain('Already recorded');
  });

  it('shows the server’s sentence on a refusal, and keeps the same key for the retry', () => {
    open();
    upi.record();

    const first = http.expectOne(`${base}/accounts/upi-clearing/settlements`);
    const firstKey = first.request.headers.get('Idempotency-Key');
    first.flush(
      { code: 'LEDGER_POSTING_REFUSED', message: 'settledAmount 250 is more than the 0 still pending' },
      { status: 422, statusText: 'Unprocessable Entity' }
    );
    fixture.detectChanges();

    expect(upi.recordError).toBe('settledAmount 250 is more than the 0 still pending');
    expect(upi.recorded).toBeNull();

    upi.record();
    const second = http.expectOne(`${base}/accounts/upi-clearing/settlements`);
    expect(second.request.headers.get('Idempotency-Key')).toBe(firstKey);
    second.flush(settlementResponse(), { status: 201, statusText: 'Created' });
    http.expectOne(`${base}/accounts/upi-clearing/pending`).flush(pendingResponse());
  });
});
