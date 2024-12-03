import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

@Component({
  selector: 'app-payment-modal',
  templateUrl: './payment-modal.component.html',
  styleUrl: './payment-modal.component.scss'
})
export class PaymentModalComponent {

  constructor(
     public dialogRef : MatDialogRef<PaymentModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data:any
  ){}

  onCancel() {
    this.dialogRef.close();
  }

  onSave(){
    this.dialogRef.close(this.data);
  }
}
