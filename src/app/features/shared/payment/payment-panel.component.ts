import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CreditCustomerResponse, SettlementMethod } from './payment.models';
import { PaymentLine, Tender } from './tender';

/**
 * How the customer paid — artboard 3's settlement block, and artboard 11's.
 *
 * ⚠ `design-ticket-booking.md` §4 and §7 both call this "the recharge counter's
 * component, unchanged" and "the same three buttons". There was no such component: it
 * was fifteen members inline in `counter.component.ts`, 599 lines of its template and
 * 1,033 of its styles (`next-session-s4.md` correction 1). This is that component, and
 * the counter is its first caller rather than a screen it was copied from — "the same
 * three buttons would have been built twice and behaved differently" is the failure the
 * design document already names.
 *
 * Deliberately dumb. Every rule and every piece of state is in `Tender`, which the host
 * owns and passes in; this file draws it. So a host can read `leftToAllocate` the moment
 * a figure is typed, and the panel being hidden takes nothing with it.
 *
 * The footer is `<ng-content>`: the figure the lines must match is shared, but what
 * happens when they do is not. The counter projects "Take payment" on F12 and a line
 * about holding the sale; the ticket screen will project its own.
 */
@Component({
  selector: 'app-payment-panel',
  templateUrl: './payment-panel.component.html',
  styleUrl: './payment-panel.component.scss'
})
export class PaymentPanelComponent {
  @Input({ required: true }) tender!: Tender;

  /**
   * Prefixes every `id` in the panel, so a label still points at its own input when two
   * screens are built from this. The counter passes `counter`, which is what its ids
   * were before the extraction.
   */
  @Input() idPrefix = 'pay';

  @Input() heading = 'How the customer paid';

  /** Enter in the cash box. The host decides what settling means. */
  @Output() submitted = new EventEmitter<void>();

  /** The three the shop takes. Drawn in this order on both artboards. */
  readonly methods: SettlementMethod[] = ['CASH', 'UPI', 'CREDIT'];

  id(suffix: string): string {
    return `${this.idPrefix}-${suffix}`;
  }

  label(method: SettlementMethod): string {
    return method === 'CREDIT' ? 'Credit' : method === 'CASH' ? 'Cash' : 'UPI';
  }

  /** `*ngFor` over the rows, so a removed method does not re-create the others. */
  rowKey(index: number, row: PaymentLine): string {
    return row.method;
  }

  onCustomerQuery(value: string): void {
    this.tender.onCustomerQuery(value);
  }

  chooseCustomer(customer: CreditCustomerResponse): void {
    this.tender.chooseCustomer(customer);
  }
}
