import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

describe('CreditShellComponent', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          {
            path: 'credit',
            loadChildren: () => import('../credit.module').then((m) => m.CreditModule)
          }
        ])
      ]
    });

    harness = await RouterTestingHarness.create();
  });

  it('shows no tabs and no Alt map, because there is one screen', async () => {
    await harness.navigateByUrl('/credit');

    expect(harness.fixture.nativeElement.querySelectorAll('.tab').length).toBe(0);
  });

  it('carries the line artboard 8 puts where the tabs would be', async () => {
    await harness.navigateByUrl('/credit');

    const subtitle = harness.fixture.nativeElement.querySelector('.section-subtitle').textContent;
    expect(subtitle).toContain('never filtered by financial year');
  });

  it('shows the operator alone — the credit book has no date and no year', async () => {
    await harness.navigateByUrl('/credit');

    const meta = harness.fixture.nativeElement.querySelector('.section-meta').textContent;
    expect(meta).not.toContain('FY');
    expect(meta).not.toContain('Oct');
  });
});
