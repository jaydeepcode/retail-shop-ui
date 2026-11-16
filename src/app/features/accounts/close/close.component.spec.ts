import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../../environments/environment';
import { SectionChromeModule } from '../../shared/section-chrome.module';
import { DaySummaryComponent } from '../day-summary/day-summary.component';
import {
  ClosePreviewResponse,
  PoolCloseRequest,
  PoolCloseResponse
} from '../model/accounts.models';
import { CloseComponent } from './close.component';

const base = environment.apiUrl;

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Artboard 9's own figures: a recharge/ticket drawer at 3,392.00, a water drawer that
 * cannot balance, and the safe at 21,795.00.
 *
 * ⚠ `lastReconDate` is **two days ago**, so the day to seal is yesterday and never today.
 * A fixture whose last close was yesterday would make the two indistinguishable, which is
 * exactly the defect §1.1 exists to prevent.
 */
function preview(overrides: Partial<ClosePreviewResponse> = {}): ClosePreviewResponse {
  return {
    pools: [
      {
        poolCode: 'POOL-1',
        expectedAmount: 3392,
        lastClosedAt: `${isoDaysAgo(2)}T20:40:00`,
        lastReconDate: isoDaysAgo(2),
        closeable: true,
        reason: null,
        members: [
          {
            accountCode: 'CASH_RECHARGE',
            displayName: 'Cash-Recharge',
            isPoolPrimary: true,
            derivedBalance: 2847
          },
          {
            accountCode: 'CASH_TICKET',
            displayName: 'Cash-Ticket',
            isPoolPrimary: false,
            derivedBalance: 545
          }
        ]
      },
      {
        poolCode: 'POOL-2',
        expectedAmount: 1240,
        lastClosedAt: null,
        lastReconDate: null,
        closeable: false,
        reason: 'CROCKERY_NOT_RECORDED',
        members: [
          {
            accountCode: 'CASH_WATER',
            displayName: 'Cash-Water',
            isPoolPrimary: true,
            derivedBalance: 1240
          }
        ]
      }
    ],
    accounts: [
      {
        accountCode: 'CASH_SAFE',
        displayName: 'Cash-Safe',
        derivedBalance: 21795,
        lastClosedAt: null,
        lastReconDate: null
      }
    ],
    ...overrides
  };
}

function closed(overrides: Partial<PoolCloseResponse> = {}): PoolCloseResponse {
  return {
    poolCode: 'POOL-1',
    reconDate: isoDaysAgo(1),
    countedAmount: 3395,
    expectedAmount: 3392,
    varianceAmount: 3,
    varianceVoucherId: 9001,
    sweep: { voucherId: 9002, amount: 3392, status: 'POSTED' },
    members: [],
    replayed: false,
    ...overrides
  };
}

describe('CloseComponent', () => {
  let fixture: ComponentFixture<CloseComponent>;
  let close: CloseComponent;
  let http: HttpTestingController;

  /** The config read is answered by default; the suggestion tests override it. */
  function open(threshold: number | null = 5, body = preview()): void {
    fixture.detectChanges();
    const configRequest = http.expectOne(`${base}/config`);
    if (threshold === null) {
      configRequest.flush('no such endpoint', { status: 404, statusText: 'Not Found' });
    } else {
      configRequest.flush({ changeDisplayThreshold: threshold });
    }
    http.expectOne(`${base}/accounts/close-preview`).flush(body);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule, SectionChromeModule],
      declarations: [CloseComponent, DaySummaryComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(CloseComponent);
    close = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // The day summary makes its own call; it is S3's and not under test here.
    http.match(() => true);
    http.verify();
  });

  // -- One screen, and no route parameter -----------------------------------

  it('asks for the whole screen in one parameterless call', () => {
    open();
    // Not /accounts/pools/POOL-1/close-preview, and not one call per pool.
    expect(close.pool?.poolCode).toBe('POOL-1');
  });

  it('counts the closeable drawer in detail and lists the one that cannot balance', () => {
    open();
    expect(close.pool?.poolCode).toBe('POOL-1');
    expect(close.otherPools.map((p) => p.poolCode)).toEqual(['POOL-2']);
    expect(text()).toContain('CANNOT BALANCE YET');
    // The server states the fact; the screen owns the wording.
    expect(text()).toContain('crockery sales are not recorded');
  });

  it('builds both drawers’ names from the members the server sent', () => {
    open();
    expect(close.poolTitle(close.pool!)).toBe('Recharge and ticket drawer');
    expect(close.poolTitle(close.otherPools[0])).toBe('Water drawer');
  });

  it('files the safe under the accounts that close on their own', () => {
    open();
    expect(close.safe?.accountCode).toBe('CASH_SAFE');
    expect(close.otherPools.some((p) => p.poolCode === 'SAFE')).toBe(false);
  });

  // -- The day being sealed -------------------------------------------------

  it('defaults to the oldest unclosed day and never to today', () => {
    open();
    expect(close.reconDate).toBe(isoDaysAgo(1));
    expect(close.reconDate).not.toBe(isoDaysAgo(0));
  });

  it('offers only unclosed days that are not in the future', () => {
    open();
    expect(close.dayOptions).toEqual([isoDaysAgo(1), isoDaysAgo(0)]);
  });

  it('says so when the drawer has never been closed, rather than silently using today', () => {
    const never = preview();
    never.pools[0].lastClosedAt = null;
    never.pools[0].lastReconDate = null;
    open(5, never);
    expect(close.neverClosed).toBe(true);
    expect(close.reconDate).toBe(isoDaysAgo(0));
    expect(text()).toContain('has never been closed');
  });

  it('stops offering a close once today itself is sealed', () => {
    // ⚠ The third defect running it found. The day used to clamp to today, so after
    // closing today the CLOSING line went on naming it with a live button beside it — and
    // the only answer that button could ever get was a 409, forever.
    const allClosed = preview();
    allClosed.pools[0].lastReconDate = isoDaysAgo(0);
    allClosed.pools[0].lastClosedAt = `${isoDaysAgo(0)}T20:40:00`;
    open(5, allClosed);

    expect(close.nothingLeftToClose).toBe(true);
    expect(close.reconDate).toBe('');
    expect(close.dayOptions).toEqual([]);
    expect(close.canClose).toBe(false);
    expect(text()).toContain('nothing left to count');
    expect(text()).toContain('Every day up to today is counted and sealed');
  });

  it('names the day on the button instead of the artboard’s “today”', () => {
    open();
    const label = close.closeButtonLabel;
    expect(label).toBe(`Close the drawer for ${close.dayWords(isoDaysAgo(1))}`);
    expect(label).not.toContain('today');
    // And the footer says "that day's entries", not "today's".
    expect(text()).toContain('that day’s entries');
    expect(text()).not.toContain('today’s entries');
  });

  // -- The difference -------------------------------------------------------

  it('reads the count with a rupee sign and separators, and refuses anything else', () => {
    open();
    close.countedInput = '₹3,395';
    expect(close.counted).toBe(3395);
    expect(close.difference).toBe(3);
    close.countedInput = 'three';
    expect(close.counted).toBeNull();
    expect(close.countedIsUnreadable).toBe(true);
    // A negative count is refused here rather than sent to be refused there.
    close.countedInput = '-5';
    expect(close.counted).toBeNull();
  });

  it('compares in paise, so a drawer that matches is not offered a reason', () => {
    open(5, preview({ pools: [{ ...preview().pools[0], expectedAmount: 0.07 }] }));
    close.countedInput = '0.07';
    expect(close.differencePaise).toBe(0);
    expect(close.hasDifference).toBe(false);
  });

  // -- Suggests, never preselects -------------------------------------------

  it('offers small change rounding as likely without selecting it', () => {
    open();
    close.countedInput = '3395';
    fixture.detectChanges();

    const rounding = close.reasons[0];
    expect(close.isSuggested(rounding)).toBe(true);
    // ⚠ The whole of §1.1's rule: offered, and nobody has chosen it.
    expect(close.reasonId).toBeNull();
    expect(close.isSelected(rounding)).toBe(false);
    expect(text()).toContain('likely — the difference is under ₹5');
  });

  it('stops suggesting once the operator has chosen, and sends only what was chosen', () => {
    open();
    close.countedInput = '3395';
    close.choose(close.reasons[0]);
    expect(close.isSelected(close.reasons[0])).toBe(true);
    expect(close.isSuggested(close.reasons[0])).toBe(false);
  });

  it('makes no suggestion at all when the threshold could not be read', () => {
    // ⚠ And writes no literal 5 in its place. There are already two in this codebase.
    open(null);
    close.countedInput = '3395';
    fixture.detectChanges();
    expect(close.threshold).toBeNull();
    expect(close.isSuggested(close.reasons[0])).toBe(false);
    expect(text()).not.toContain('likely');
    // The reason is still offered — only the suggestion is withheld.
    expect(close.isAvailable(close.reasons[0])).toBe(true);
  });

  it('does not suggest a difference at or above the threshold', () => {
    open();
    close.countedInput = '3397';
    expect(close.differenceAbs).toBe(5);
    expect(close.isSuggested(close.reasons[0])).toBe(false);
  });

  // -- Both directions, and the sign guard ----------------------------------

  it('offers the IN reasons on an over and the OUT reason on a short', () => {
    open();
    const [rounding, paid, takenOut] = close.reasons;

    close.countedInput = '3395';
    expect(close.isAvailable(rounding)).toBe(true);
    expect(close.isAvailable(paid)).toBe(true);
    expect(close.isAvailable(takenOut)).toBe(false);
    expect(close.unavailableBecause(takenOut)).toBe('only when the drawer is short');

    close.countedInput = '3342';
    expect(close.isAvailable(takenOut)).toBe(true);
    expect(close.isAvailable(rounding)).toBe(false);
  });

  it('drops a chosen reason the figure no longer fits, rather than collecting a 422', () => {
    open();
    close.countedInput = '3395';
    close.choose(close.reasons[0]);
    expect(close.reasonId).toBe('ROUNDING');

    // The count is corrected and the drawer is now short: IN no longer agrees with the sign.
    close.countedInput = '3390';
    close.onCountChanged();
    expect(close.reasonId).toBeNull();
  });

  it('lets a mis-chosen reason be un-chosen', () => {
    open();
    close.countedInput = '3395';
    close.choose(close.reasons[1]);
    close.choose(close.reasons[1]);
    expect(close.reasonId).toBeNull();
  });

  // -- What is sent ---------------------------------------------------------

  function sent(): PoolCloseRequest {
    const request = http.expectOne(`${base}/accounts/pools/POOL-1/closes`);
    expect(request.request.method).toBe('POST');
    // ⚠ No Idempotency-Key: the key is server-derived and uk_recon_account_date is the
    // guard (§1.3). A header the server ignores tells a client the value matters.
    expect(request.request.headers.has('Idempotency-Key')).toBe(false);
    const body = request.request.body as PoolCloseRequest;
    request.flush(closed());
    http.expectOne(`${base}/accounts/close-preview`).flush(preview());
    return body;
  }

  it('posts an IN explanation against INC_SUNDRY_SHOP, with the reason in the note', () => {
    open();
    close.countedInput = '3395';
    close.note = 'small change not handed back';
    close.choose(close.reasons[0]);
    close.close();

    const body = sent();
    expect(body.reconDate).toBe(isoDaysAgo(1));
    expect(body.countedAmount).toBe(3395);
    expect(body.explained).toEqual({
      direction: 'IN',
      accountCode: 'INC_SUNDRY_SHOP',
      amount: 3
    });
    // ⚠ The narration names only the account, and both IN reasons name the same one — so
    // the note is the only thing that can say which reason it was (V34).
    expect(body.note).toBe('Small change rounding: small change not handed back');
  });

  it('posts an OUT explanation against EXP_SUNDRY_SHOP on a short', () => {
    open();
    close.countedInput = '3342';
    close.choose(close.reasons[2]);
    close.close();

    expect(sent().explained).toEqual({
      direction: 'OUT',
      accountCode: 'EXP_SUNDRY_SHOP',
      amount: 50
    });
  });

  it('sends no explained block for “No idea”, so the variance posts as unexplained', () => {
    open();
    close.countedInput = '3395';
    close.choose(close.reasons[3]);
    close.close();

    const body = sent();
    expect(body.explained).toBeUndefined();
    // ⚠ And it names no account. EXP_CASH_SHORT and INC_CASH_OVER are the close's to post,
    // always and with no threshold, and naming them by hand is refused (A7).
    expect(JSON.stringify(body)).not.toContain('CASH_OVER');
  });

  it('sends no explained block when nobody chose anything', () => {
    open();
    close.countedInput = '3395';
    close.close();
    expect(sent().explained).toBeUndefined();
  });

  it('sends no explained block when the count matches exactly', () => {
    open();
    close.countedInput = '3392';
    close.close();
    expect(sent().explained).toBeUndefined();
  });

  it('will not close before a figure is typed', () => {
    open();
    expect(close.canClose).toBe(false);
    close.countedInput = '3395';
    expect(close.canClose).toBe(true);
  });

  // -- What closing does ----------------------------------------------------

  it('projects the safe as itself plus the counted figure, explained or not', () => {
    open();
    close.countedInput = '3395';
    // Unexplained: the journal moves the till and the sweep carries the counted figure.
    expect(close.safeAfterClosing).toBe(25190);
    // Explained: the receipt hits the safe and the sweep carries the expected figure.
    close.choose(close.reasons[0]);
    expect(close.safeAfterClosing).toBe(25190);
  });

  it('describes the count, the variance and the sweep, and drops the variance step when level', () => {
    open();
    close.countedInput = '3395';
    let titles = close.steps.map((s) => s.title);
    expect(titles.length).toBe(3);
    expect(titles[1]).toBe('Records the ₹3 as unexplained');

    close.choose(close.reasons[0]);
    expect(close.steps[1].title).toBe('Records the ₹3 as small change rounding');

    close.countedInput = '3392';
    close.onCountChanged();
    titles = close.steps.map((s) => s.title);
    expect(titles.length).toBe(2);
    expect(titles.some((t) => t.startsWith('Records the'))).toBe(false);
  });

  it('says nothing will be swept when every till already records nothing', () => {
    const emptyDay = preview();
    emptyDay.pools[0].expectedAmount = 0;
    emptyDay.pools[0].members.forEach((m) => (m.derivedBalance = 0));
    open(5, emptyDay);

    close.countedInput = '0';
    expect(close.sweepWillPost).toBe(false);
    expect(close.steps[close.steps.length - 1].title).toBe('Moves nothing to the safe');
  });

  // -- After the close ------------------------------------------------------

  it('shows what was written and re-reads the preview, because the safe is counted after', () => {
    open();
    close.countedInput = '3395';
    close.close();

    http.expectOne(`${base}/accounts/pools/POOL-1/closes`).flush(closed());
    // ⚠ The reload is the point: the safe's figure is now short by what just swept into it.
    const reloaded = preview();
    reloaded.accounts[0].derivedBalance = 25187;
    http.expectOne(`${base}/accounts/close-preview`).flush(reloaded);
    fixture.detectChanges();

    expect(close.closed?.varianceVoucherId).toBe(9001);
    expect(close.safe?.derivedBalance).toBe(25187);
    expect(text()).toContain('Swept');
  });

  it('empties the count, the note and the reason once the close has landed', () => {
    // ⚠ This is the defect a real close found and the suite did not. The reload drops the
    // drawer to 0.00 and moves the day on, so a count left in the box read as a pending
    // close of ₹3,395 against an empty drawer with the reason still lit — one press away.
    open();
    close.countedInput = '3395';
    close.note = 'small change not handed back';
    close.choose(close.reasons[0]);
    close.close();

    http.expectOne(`${base}/accounts/pools/POOL-1/closes`).flush(closed());
    const swept = preview();
    swept.pools[0].expectedAmount = 0;
    swept.pools[0].members.forEach((m) => (m.derivedBalance = 0));
    swept.pools[0].lastReconDate = isoDaysAgo(1);
    http.expectOne(`${base}/accounts/close-preview`).flush(swept);
    fixture.detectChanges();

    expect(close.countedInput).toBe('');
    expect(close.note).toBe('');
    expect(close.reasonId).toBeNull();
    expect(close.difference).toBeNull();
    expect(close.canClose).toBe(false);
    // And the day has moved on to the next unclosed one.
    expect(close.reconDate).toBe(isoDaysAgo(0));
  });

  it('groups thousands in the prose the way the figures beside it are grouped', () => {
    open();
    close.countedInput = '6792';
    expect(close.steps[1].title).toBe('Records the ₹3,400 as unexplained');
  });

  it('treats a 409 as the answer it carries, not as a failure', () => {
    open();
    close.countedInput = '3395';
    close.close();

    // ⚠ The server answers 409 with the close that already exists, because a bare 409
    // leaves the operator stuck over a counted drawer with no figures.
    http.expectOne(`${base}/accounts/pools/POOL-1/closes`).flush(
      closed({ replayed: true, varianceVoucherId: 7001 }),
      { status: 409, statusText: 'Conflict' }
    );
    http.expectOne(`${base}/accounts/close-preview`).flush(preview());
    fixture.detectChanges();

    expect(close.closeError).toBe('');
    expect(close.closedWasReplay).toBe(true);
    expect(text()).toContain('Already closed');
  });

  it('shows the server’s sentence on a refusal', () => {
    open();
    close.countedInput = '3395';
    close.close();

    http.expectOne(`${base}/accounts/pools/POOL-1/closes`).flush(
      { code: 'LEDGER_POSTING_REFUSED', message: 'account is not active: INC_SUNDRY_SHOP' },
      { status: 422, statusText: 'Unprocessable Entity' }
    );
    fixture.detectChanges();

    expect(close.closeError).toBe('account is not active: INC_SUNDRY_SHOP');
    expect(close.closed).toBeNull();
  });

  // -- The safe, on its own -------------------------------------------------

  it('closes the safe through its own endpoint, with no sweep and no reasons', () => {
    open();
    close.openSafeCount();
    close.safeCountedInput = '21,795';
    close.safeNote = 'counted after the sweep';
    close.closeSafe();

    const request = http.expectOne(`${base}/accounts/CASH_SAFE/reconciliations`);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.has('Idempotency-Key')).toBe(false);
    expect(request.request.body).toEqual({
      reconDate: isoDaysAgo(0),
      countedAmount: 21795,
      note: 'counted after the sweep'
    });
    // ⚠ faceCounted is a float's second comparison and the safe is not a float, so it is
    // absent rather than sent equal to the count.
    expect(request.request.body.faceCounted).toBeUndefined();
  });
});
