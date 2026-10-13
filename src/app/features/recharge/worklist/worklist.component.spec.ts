import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { environment } from '../../../../environments/environment';
import { SectionChromeModule } from '../../shared/section-chrome.module';
import {
  CounterConfigResponse,
  PageResponse,
  RechargeWorkItemResponse
} from '../model/recharge.models';
import { WorklistComponent } from './worklist.component';

const CONFIG: CounterConfigResponse = {
  operators: [
    { code: 'VI', name: 'Vi', serviceType: 'MOBILE', defaultRouteCode: 'DIRECT', presets: [] }
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

function item(overrides: Partial<RechargeWorkItemResponse> = {}): RechargeWorkItemResponse {
  return {
    rechargeId: 99051,
    reference: 'R-99051',
    serviceType: 'MOBILE',
    number: '9823014772',
    operatorCode: 'VI',
    operatorName: 'Vi',
    routeCode: 'DIRECT',
    amount: 398,
    surcharge: 0,
    rechargeAt: '2026-10-13T14:06:00',
    paymentId: 73485,
    failureReason: null,
    ...overrides
  };
}

function pageOf(content: RechargeWorkItemResponse[]): PageResponse<RechargeWorkItemResponse> {
  return { content, page: 0, size: 50, totalElements: content.length, totalPages: 1 };
}

describe('WorklistComponent', () => {
  let fixture: ComponentFixture<WorklistComponent>;
  let worklist: WorklistComponent;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/recharge`;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule, RouterTestingModule, SectionChromeModule],
      declarations: [WorklistComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(WorklistComponent);
    worklist = fixture.componentInstance;
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

  function load(awaiting: RechargeWorkItemResponse[], failures: RechargeWorkItemResponse[]): void {
    http.expectOne((r) => r.url === `${base}/recharges/awaiting`).flush(pageOf(awaiting));
    http.expectOne((r) => r.url === `${base}/recharges/failures`).flush(pageOf(failures));
    http.expectOne(`${base}/config`).flush(CONFIG);
    fixture.detectChanges();
  }

  /**
   * ⚠ The empty state is the MAIN state. 468 of 681 active hours held exactly one
   * recharge, so this tray is normally empty — it has to say so in words rather than
   * showing a bare table with no rows.
   */
  it('says nothing is waiting when both trays are empty', () => {
    load([], []);
    expect(worklist.isEmpty).toBe(true);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Nothing waiting');
    expect(text).toContain('normally empty');
    // No table at all, not an empty one.
    expect(fixture.nativeElement.querySelector('.rows')).toBeNull();
  });

  it('never asks either tray for a financial year', () => {
    const awaiting = http.expectOne((r) => r.url === `${base}/recharges/awaiting`);
    const failures = http.expectOne((r) => r.url === `${base}/recharges/failures`);
    expect(awaiting.request.params.has('financialYear')).toBe(false);
    expect(failures.request.params.has('financialYear')).toBe(false);
    awaiting.flush(pageOf([]));
    failures.flush(pageOf([]));
    http.expectOne(`${base}/config`).flush(CONFIG);
  });

  it('selects the first waiting row so the keyboard has something to act on', () => {
    load([item(), item({ rechargeId: 99052 })], []);
    expect(worklist.selected?.rechargeId).toBe(99051);
  });

  it('sums the money held across both trays', () => {
    load([item({ amount: 398, surcharge: 0 })], [item({ rechargeId: 99060, amount: 240, surcharge: 10 })]);
    expect(worklist.heldHere).toBe(648);
    expect(worklist.failuresHeld).toBe(250);
  });

  it('completes one recharge per call and re-reads rather than splicing', () => {
    load([item(), item({ rechargeId: 99052, number: '9881203114' })], []);
    worklist.markDone();

    const complete = http.expectOne(`${base}/recharges/99051/complete`);
    expect(complete.request.body).toEqual({});
    complete.flush({});
    fixture.detectChanges();

    // One call went out, and the trays are re-read from the server.
    http.expectOne((r) => r.url === `${base}/recharges/awaiting`).flush(pageOf([item({ rechargeId: 99052 })]));
    http.expectOne((r) => r.url === `${base}/recharges/failures`).flush(pageOf([]));
    fixture.detectChanges();
    expect(worklist.awaiting.length).toBe(1);
  });

  it('sends the route override on completion', () => {
    load([item()], []);
    worklist.routeOverride = 'A1TOPUP';
    worklist.markDone();
    const request = http.expectOne(`${base}/recharges/99051/complete`);
    expect(request.request.body).toEqual({ routeCode: 'A1TOPUP' });
    request.flush({});
  });

  it('offers no bulk complete-all control', () => {
    load([item(), item({ rechargeId: 99052 })], []);
    const text = (fixture.nativeElement.textContent as string).toLowerCase();
    expect(text).not.toContain('complete all');
    expect(text).not.toContain('mark all');
    expect((worklist as unknown as Record<string, unknown>)['completeAll']).toBeUndefined();
  });

  it('links a failure through to its own screen rather than resolving it here', () => {
    load([], [item({ rechargeId: 99060, failureReason: 'operator declined' })]);
    const link = fixture.nativeElement.querySelector('a.btn-small') as HTMLAnchorElement;
    expect(link.textContent?.trim()).toBe('Sort it out');
    expect(link.getAttribute('href')).toContain('99060');
  });
});
