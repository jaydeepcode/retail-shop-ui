import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

describe('TicketsShellComponent', () => {
  let harness: RouterTestingHarness;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          {
            path: 'tickets',
            loadChildren: () => import('../tickets.module').then((m) => m.TicketsModule)
          }
        ])
      ]
    });

    harness = await RouterTestingHarness.create();
    router = TestBed.inject(Router);
  });

  it('has the two tabs artboard 11 draws, not the one screen the note expected', async () => {
    await harness.navigateByUrl('/tickets');

    expect(router.url).toBe('/tickets/new');
    const labels = Array.from<HTMLElement>(harness.fixture.nativeElement.querySelectorAll('.tab-label')).map(
      (tab) => tab.textContent?.trim()
    );
    expect(labels).toEqual(['New booking', 'Today']);
  });

  it('reaches Today on Alt+2', async () => {
    await harness.navigateByUrl('/tickets/new');

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', altKey: true }));
    await harness.fixture.whenStable();

    expect(router.url).toBe('/tickets/today');
  });
});
