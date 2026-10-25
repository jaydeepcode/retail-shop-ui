import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PaymentPanelComponent } from './payment-panel.component';

/**
 * The settlement block, for any screen that takes money.
 *
 * `RechargeModule` imports it for the counter; `TicketsModule` will for artboard 11.
 * Nothing else belongs in here — `Tender` is a plain class and is imported directly.
 */
@NgModule({
  declarations: [PaymentPanelComponent],
  imports: [CommonModule, FormsModule],
  exports: [PaymentPanelComponent]
})
export class PaymentModule {}
