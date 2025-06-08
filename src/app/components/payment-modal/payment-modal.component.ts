import { animate, state, style, transition, trigger } from '@angular/animations';
import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { AuthService } from '../../services/auth.service';
import { BaseDialogComponent } from '../shared/base-dialog.component';

@Component({
  selector: 'app-payment-modal',
  templateUrl: './payment-modal.component.html',
  styleUrl: './payment-modal.component.scss',
  animations: [trigger('transitionMessages', [
    state('void', style({ opacity: 0 })),
    state('*', style({ opacity: 1 })),
    transition(':enter', [animate('300ms ease-in')]),
    transition(':leave', [animate('300ms ease-out')])])]
})
export class PaymentModalComponent extends BaseDialogComponent {
  readonly fb = inject(FormBuilder);
  readonly data = inject(MAT_DIALOG_DATA);
  
  payFormGroup: FormGroup = this.fb.group({
    paymentAmount: [this.data.paymentAmount, [Validators.required, Validators.min(1)]],
    paymentMode: ['', Validators.required],
  });

  constructor(
    dialogRef: MatDialogRef<PaymentModalComponent>,
    authService: AuthService
  ) {
    super(dialogRef, authService);
  }

  onCancel() {
    this.dialogRef.close();
  }

  onSave() {
    this.dialogRef.close(this.payFormGroup.value);
  }
}
