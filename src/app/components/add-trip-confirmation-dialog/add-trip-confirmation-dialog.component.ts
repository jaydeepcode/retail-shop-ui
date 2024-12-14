import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'app-add-trip-confirmation-dialog',
  templateUrl: './add-trip-confirmation-dialog.component.html',
  styleUrl: './add-trip-confirmation-dialog.component.scss'
})
export class AddTripConfirmationDialogComponent {
  confirmationForm: FormGroup
  constructor(private fb: FormBuilder,
    private dialogRef: MatDialogRef<AddTripConfirmationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any) {
    this.confirmationForm = this.fb.group({ 
      amount: [data.amount, [Validators.required, Validators.min(1)]] 
    });

  }
  onCancel(): void { this.dialogRef.close(); }
  onConfirm(): void { this.dialogRef.close(this.confirmationForm.value); }
}
