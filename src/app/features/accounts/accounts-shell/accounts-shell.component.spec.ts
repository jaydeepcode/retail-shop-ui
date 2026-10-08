import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

describe('AccountsShellComponent', () => {
  let harness: RouterTestingHarness;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          {
            path: 'accounts',
            loadChildren: () => import('../accounts.module').then((m) => m.AccountsModule)
          }
        ])
      ]
    });

    harness = await RouterTestingHarness.create();
    router = TestBed.inject(Router);
  });

  function labels(): (string | undefined)[] {
    return Array.from<HTMLElement>(harness.fixture.nativeElement.querySelectorAll('.tab-label')).map((tab) =>
      tab.textContent?.trim()
    );
  }

  it('opens on the count, which is what seals the day', async () => {
    await harness.navigateByUrl('/accounts');

    expect(router.url).toBe('/accounts/close');
  });

  it('uses the artboard labels, including Move money rather than transfers', async () => {
    await harness.navigateByUrl('/accounts/close');

    expect(labels()).toEqual(['Count the drawer', 'UPI', 'Expenses', 'Move money', 'Reports']);
  });

  it('routes Move money to transfers, which is the name the planning note uses', async () => {
    await harness.navigateByUrl('/accounts/close');

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit4', altKey: true }));
    await harness.fixture.whenStable();

    expect(router.url).toBe('/accounts/transfers');
  });

  it('leaves the financial year off this section, as artboard 9 does', async () => {
    await harness.navigateByUrl('/accounts/close');

    const meta = harness.fixture.nativeElement.querySelector('.section-meta').textContent;
    expect(meta).not.toContain('FY');
  });

  it('carries no float strip — that belongs to recharge', async () => {
    await harness.navigateByUrl('/accounts/close');

    expect(harness.fixture.nativeElement.querySelector('.float-strip')).toBeNull();
  });
});
