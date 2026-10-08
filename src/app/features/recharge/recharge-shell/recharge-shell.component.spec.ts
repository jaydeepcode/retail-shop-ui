import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

/**
 * The section shell, exercised through the real router so the redirect, the tab
 * highlighting and the Alt map are all tested as they actually resolve.
 */
describe('RechargeShellComponent', () => {
  let harness: RouterTestingHarness;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          {
            path: 'recharge',
            loadChildren: () => import('../recharge.module').then((m) => m.RechargeModule)
          }
        ])
      ]
    });

    harness = await RouterTestingHarness.create();
    router = TestBed.inject(Router);
  });

  /** The bar's tabs, in the order they are rendered. */
  function tabs(): HTMLAnchorElement[] {
    return Array.from(harness.fixture.nativeElement.querySelectorAll('.tab'));
  }

  function currentTabLabel(): string | undefined {
    const current = harness.fixture.nativeElement.querySelector('.tab.is-current');
    return current?.querySelector('.tab-label')?.textContent?.trim();
  }

  it('opens on the counter, not on a search screen', async () => {
    await harness.navigateByUrl('/recharge');

    expect(router.url).toBe('/recharge/counter');
    expect(currentTabLabel()).toBe('Counter');
  });

  it('draws the five tabs the artboards draw, and no Failures tab', async () => {
    await harness.navigateByUrl('/recharge/counter');

    const labels = tabs().map((tab) => tab.querySelector('.tab-label')?.textContent?.trim());
    expect(labels).toEqual(['Counter', 'Worklist', 'History', 'Float top-up', 'Rates']);
  });

  it('hints and declares a shortcut on every tab, matching its position', async () => {
    await harness.navigateByUrl('/recharge/counter');

    tabs().forEach((tab, index) => {
      expect(tab.querySelector('.tab-shortcut')?.textContent?.trim()).toBe(`Alt+${index + 1}`);
      expect(tab.getAttribute('aria-keyshortcuts')).toBe(`Alt+${index + 1}`);
    });
  });

  it('navigates on Alt + the tab position', async () => {
    await harness.navigateByUrl('/recharge/counter');

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit4', altKey: true }));
    await harness.fixture.whenStable();

    expect(router.url).toBe('/recharge/float');
    expect(currentTabLabel()).toBe('Float top-up');
  });

  it('leaves Alt+6 alone, because there is no sixth tab', async () => {
    await harness.navigateByUrl('/recharge/counter');

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit6', altKey: true }));
    await harness.fixture.whenStable();

    expect(router.url).toBe('/recharge/counter');
  });

  it('ignores Alt when the browser or the OS already owns the combination', async () => {
    await harness.navigateByUrl('/recharge/counter');

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', altKey: true, metaKey: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', altKey: true, ctrlKey: true }));
    await harness.fixture.whenStable();

    expect(router.url).toBe('/recharge/counter');
  });

  it('keeps the Worklist tab lit while a failure is being sorted out', async () => {
    await harness.navigateByUrl('/recharge/worklist/9881203114');

    expect(currentTabLabel()).toBe('Worklist');
  });

  it('carries the float strip on the counter and drops it on the failure screen', async () => {
    await harness.navigateByUrl('/recharge/counter');
    expect(harness.fixture.nativeElement.querySelector('.float-strip')).toBeTruthy();

    await harness.navigateByUrl('/recharge/worklist/9881203114');
    expect(harness.fixture.nativeElement.querySelector('.float-strip')).toBeNull();
  });

  it('stubs no float balances, because no endpoint serves them', async () => {
    await harness.navigateByUrl('/recharge/counter');

    const wallets = Array.from<HTMLElement>(harness.fixture.nativeElement.querySelectorAll('.float-wallet'));
    expect(wallets.map((wallet) => wallet.textContent?.trim())).toEqual([
      'Airtel —',
      'Vi —',
      'Jio —',
      'A1Topup —'
    ]);
  });

  it('offers a way back to the dashboard, which the artboards leave as plain text', async () => {
    await harness.navigateByUrl('/recharge/counter');

    const name: HTMLAnchorElement = harness.fixture.nativeElement.querySelector('.section-name');
    expect(name.getAttribute('href')).toBe('/home');
  });
});
