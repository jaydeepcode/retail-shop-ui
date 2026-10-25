import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PaymentModule } from './payment.module';
import { CreditCustomerResponse } from './payment.models';
import { CustomerDirectory, Tender } from './tender';

const DIRECTORY: CustomerDirectory = {
  searchCustomers: () => of([] as CreditCustomerResponse[]),
  createCustomer: () => of({} as CreditCustomerResponse)
};

/**
 * Two panels on one page, which is the case `idPrefix` exists for, and a projected
 * footer, which is how a host says what settling means.
 */
@Component({
  template: `
    <app-payment-panel [tender]="left" idPrefix="counter" (submitted)="submits = submits + 1">
      <button type="button" class="btn-take">Take payment</button>
    </app-payment-panel>
    <app-payment-panel [tender]="right" idPrefix="ticket" heading="How they paid for it">
    </app-payment-panel>
  `
})
class HostComponent {
  submits = 0;
  leftTotal = 299;
  readonly left = new Tender({
    directory: DIRECTORY,
    totalToMatch: () => this.leftTotal,
    changeThreshold: () => 5,
    errorSentence: () => 'no',
    asExistingCustomer: () => null
  });
  readonly right = new Tender({
    directory: DIRECTORY,
    totalToMatch: () => 485,
    changeThreshold: () => 5,
    errorSentence: () => 'no',
    asExistingCustomer: () => null
  });
}

describe('PaymentPanelComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaymentModule],
      declarations: [HostComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    host.left.destroy();
    host.right.destroy();
  });

  it('draws the same three buttons on both, in the order the artboards draw them', () => {
    const labels = Array.from(fixture.nativeElement.querySelectorAll('app-payment-panel'))
      .map((panel) => Array.from((panel as HTMLElement).querySelectorAll('.method'))
        .map((b) => (b as HTMLElement).textContent?.trim().replace(' ✓', '')));
    expect(labels).toEqual([['Cash', 'UPI', 'Credit'], ['Cash', 'UPI', 'Credit']]);
  });

  it('takes its heading from the host, because a ticket is not a recharge', () => {
    const headings = Array.from(fixture.nativeElement.querySelectorAll('.card-title'))
      .map((h) => (h as HTMLElement).textContent?.trim());
    expect(headings).toEqual(['How the customer paid', 'How they paid for it']);
  });

  /**
   * ⚠ The reason `idPrefix` is an input rather than a constant. Two panels sharing an
   * `id` would point both labels at one input, and a screen reader would read the
   * second row's label onto the first row's box.
   */
  it('keeps every id unique across two panels, with each label pointing at its own input', () => {
    host.left.toggleMethod('CREDIT');
    host.right.toggleMethod('CREDIT');
    fixture.detectChanges();

    const ids = Array.from(fixture.nativeElement.querySelectorAll('input[id]'))
      .map((el) => (el as HTMLInputElement).id);
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);

    const unlabelled = Array.from(fixture.nativeElement.querySelectorAll('.pay-row input'))
      .filter((el) => {
        const input = el as HTMLInputElement;
        const byFor = input.id && fixture.nativeElement.querySelector(`label[for="${input.id}"]`);
        return !byFor && !input.getAttribute('aria-label');
      });
    expect(unlabelled.length).toBe(0);
    expect(ids.some((id) => id.startsWith('counter-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('ticket-'))).toBe(true);
  });

  it('projects the host footer, so the panel never owns the primary button', () => {
    const take = fixture.nativeElement.querySelector('.pay-foot .btn-take');
    expect(take).toBeTruthy();
    expect(take.textContent.trim()).toBe('Take payment');
  });

  it('asks the host to settle when Enter is pressed in the cash box', () => {
    const cash = fixture.nativeElement.querySelector('#counter-tendered') as HTMLInputElement;
    cash.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(host.submits).toBe(1);
  });

  it('matches the total its own host supplies, not the other panel one', () => {
    host.left.toggleMethod('UPI');
    host.right.toggleMethod('UPI');
    fixture.detectChanges();

    const figures = Array.from(fixture.nativeElement.querySelectorAll('.left-to-allocate .mono'))
      .map((el) => (el as HTMLElement).textContent?.trim());
    expect(figures).toEqual(['₹299.00', '₹485.00']);
  });

  it('shows its own 5-line refusal without needing a host to put it in', () => {
    host.left.lines.push(
      { method: 'UPI', amount: null },
      { method: 'UPI', amount: null },
      { method: 'UPI', amount: null },
      { method: 'UPI', amount: null }
    );
    host.left.toggleMethod('CREDIT');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('A payment takes at most 5 lines.');
  });
});
