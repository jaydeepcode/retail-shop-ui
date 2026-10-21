import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { environment } from '../../../../environments/environment';
import { SectionChromeModule } from '../../shared/section-chrome.module';
import { CounterConfigResponse, HistoryPageResponse, RechargeResponse } from '../model/recharge.models';
import { HistoryComponent } from './history.component';
import { NumberGroupsPipe } from '../number-groups.pipe';

const CONFIG: CounterConfigResponse = {
  operators: [
    { code: 'JIO', name: 'Jio', serviceType: 'MOBILE', defaultRouteCode: 'DIRECT', presets: [299] }
  ],
  routes: [{ code: 'DIRECT', name: 'Direct' }],
  creditWarningDays: 30,
  fyStartMonth: 4,
  currentFinancialYear: '2026-27',
  changeDisplayThreshold: 5,
  surchargeDefaultTv: 10,
  surchargeDefaultMobile: 0
};

function row(overrides: Partial<RechargeResponse> = {}): RechargeResponse {
  return {
    rechargeId: 99051,
    reference: 'R-99051',
    serviceType: 'MOBILE',
    number: '9823014772',
    operatorCode: 'JIO',
    operatorName: 'Jio',
    routeCode: 'DIRECT',
    routeName: 'Direct',
    routeConfirmed: true,
    amount: 299,
    surcharge: 0,
    status: 'COMPLETED',
    resolution: 'NONE',
    vendorRef: null,
    retryOfRechargeId: null,
    failureReason: null,
    rechargeAt: '2026-10-05T14:06:00',
    statusChangedAt: '2026-10-05T14:07:00',
    ...overrides
  };
}

function page(content: RechargeResponse[], availableYears: string[]): HistoryPageResponse {
  return {
    financialYear: '2026-27',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    availableYears,
    page: {
      content,
      page: 0,
      size: 20,
      totalElements: content.length,
      totalPages: content.length ? 1 : 0
    }
  };
}

describe('HistoryComponent', () => {
  let fixture: ComponentFixture<HistoryComponent>;
  let history: HistoryComponent;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/recharge`;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule, RouterTestingModule, SectionChromeModule],
      declarations: [HistoryComponent, NumberGroupsPipe]
    }).compileComponents();

    fixture = TestBed.createComponent(HistoryComponent);
    history = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(`${base}/config`).flush(CONFIG);
  });

  afterEach(() => {
    // Drain anything still in flight (a background refresh, say) WITHOUT flushing a body
    // into it: match() removes the requests, so verify() is still meaningful about the
    // ones each test asserted on.
    http.match(() => true);
    http.verify();
  });

  function respond(result: HistoryPageResponse): void {
    http.expectOne((r) => r.url === `${base}/history`).flush(result);
    fixture.detectChanges();
  }

  it('takes the current financial year from the server, not from the clock', () => {
    expect(history.financialYear).toBe('2026-27');
  });

  /**
   * ⚠ The two empty states need different sentences. `availableYears: []` means nothing
   * has been recorded yet — `rc_recharge` is empty until V15 runs at cutover — and
   * without that distinction the screen reads as broken on day one.
   */
  it('says nothing is recorded yet when availableYears is empty', () => {
    respond(page([], []));
    expect(history.nothingRecordedYet).toBe(true);
    expect(history.noMatches).toBe(false);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('No recharges recorded yet');
    expect(text).toContain('nothing is missing and nothing is broken');
  });

  it('says the filter matched nothing when years exist but no rows came back', () => {
    respond(page([], ['2026-27', '2025-26']));
    expect(history.noMatches).toBe(true);
    expect(history.nothingRecordedYet).toBe(false);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Nothing matches that');
    expect(text).not.toContain('No recharges recorded yet');
  });

  it('lists one row per recharge once there are rows', () => {
    respond(page([row(), row({ rechargeId: 99052, number: '9881203114' })], ['2026-27']));
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('sends the number as a prefix, digits only', () => {
    respond(page([row()], ['2026-27']));
    history.onNumberInput('9823 01');
    history.load();
    const request = http.expectOne((r) => r.url === `${base}/history`);
    expect(request.request.params.get('number')).toBe('982301');
    request.flush(page([row()], ['2026-27']));
  });

  it('offers no name search, because most recharges have no name at all', () => {
    respond(page([row()], ['2026-27']));
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.filter label')
    ).map((l) => (l as HTMLElement).textContent?.trim());
    expect(labels).toEqual(['Year', 'Number starts with', 'Operator', 'Status']);
  });

  /**
   * ⚠ Still no void control, and the reason has moved again — which is the point of
   * asserting the words rather than only the absence of a button.
   *
   * It was "the books would overstate income", then "a void cannot hand the money back".
   * Now the endpoint is WITHDRAWN (log §16.1): the second reason is exactly why the
   * backend removed it. A delivered sale that should be undone is marked failed and then
   * given back, both of which have buttons here.
   */
  it('offers no way to void a completed sale, and says what to do instead', () => {
    respond(page([row({ status: 'COMPLETED' })], ['2026-27']));
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Void it');
    expect(fixture.nativeElement.querySelector('[data-void]')).toBeNull();
    expect(text).toContain('withdrawn');
    expect(text).toContain('marked failed and then given back');
    // ⚠ And it must repeat neither of the two reasons that have since gone stale.
    expect(text).not.toContain('the reversing voucher is not posted');
    expect(text).not.toContain('still has no button');
  });

  /**
   * ⚠ THE FILTER GOES AND THE RENDERING STAYS, which is the whole of item 3.
   *
   * `VOIDED` is now defined, terminal and unreachable, so a filter for it could only ever
   * return nothing. But the status is still on the wire and V9 still seeds the reference
   * row, so a row from any source must still render honestly rather than fall through a
   * switch.
   */
  it('no longer offers a Voided filter, but still renders a voided row', () => {
    respond(page([row()], ['2026-27']));
    expect(history.statuses.map((s) => s.value)).toEqual([
      '', 'COMPLETED', 'AWAITING_RECHARGE', 'FAILED'
    ]);

    expect(history.statusLabel(row({ status: 'VOIDED' }))).toBe('VOIDED');
    expect(history.statusTone(row({ status: 'VOIDED' }))).toBe('muted');
  });

  it('badges a resolved failure with its resolution, which is a separate field', () => {
    respond(page([row({ status: 'FAILED', resolution: 'REFUNDED' })], ['2026-27']));
    expect(history.statusLabel(row({ status: 'FAILED', resolution: 'REFUNDED' }))).toBe(
      'FAILED · REFUNDED'
    );
    expect(history.statusLabel(row({ status: 'FAILED', resolution: 'NONE' }))).toBe('FAILED');
  });

  it('resets to page one when a filter changes', () => {
    respond(page([row()], ['2026-27']));
    history.page = 3;
    history.onFilterChange();
    const request = http.expectOne((r) => r.url === `${base}/history`);
    expect(request.request.params.get('page')).toBe('0');
    request.flush(page([row()], ['2026-27']));
  });
});
