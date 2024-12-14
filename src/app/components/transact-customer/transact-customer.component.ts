import { Component, OnInit } from '@angular/core';
import { CustomerService } from '../../services/CustomerService';
import { CustomerPayment, CustomerProfile, RcCreditReqDTO, WaterPurchasePartyDTO, WaterPurchaseTransactionDTO } from '../../model/model';
import { WaterService } from '../../services/WaterService';
import { AlertService, AlertType } from '../../services/alert.service';
import { MatDialog } from '@angular/material/dialog';
import { PaymentModalComponent } from '../payment-modal/payment-modal.component';
import { ActivatedRoute } from '@angular/router';
import { AddTripConfirmationDialogComponent } from '../add-trip-confirmation-dialog/add-trip-confirmation-dialog.component';

@Component({
  selector: 'app-transact-customer',
  templateUrl: './transact-customer.component.html',
  styleUrl: './transact-customer.component.scss'
})
export class TransactCustomerComponent implements OnInit {

  public waterPurchaseTransaction: WaterPurchaseTransactionDTO | undefined;
  purchaseParty: WaterPurchasePartyDTO | undefined;
  customerName: string | undefined;
  isRecording: boolean = false;
  totalPendingAmount: number = 0;
  constructor(private waterService: WaterService, private alertService: AlertService,
    private dialog: MatDialog,
    private activatedRoute: ActivatedRoute) { }

  ngOnInit(): void {
    this.waterPurchaseTransaction = this.activatedRoute.snapshot.data['customerData'];
    if (this.waterPurchaseTransaction) {
      this.totalPendingAmount = this.waterPurchaseTransaction.balanceAmount;
      this.purchaseParty = this.waterPurchaseTransaction.waterPurchaseParty;
      this.customerName = this.waterPurchaseTransaction.customerName;
    }
  }

  performAction() {
    this.calculateAmount().subscribe(calculatedAmount => {
      const dialogRef = this.dialog.open(AddTripConfirmationDialogComponent, { data: { amount: calculatedAmount } });
      dialogRef.afterClosed().subscribe(result => { if (result) { this.confirmTrip(result.amount); } });
    });
  
  }

  confirmTrip(amount: number) {
    this.isRecording = true;
    this.waterService.addWaterTrip(this.purchaseParty?.customerId,amount).subscribe({
      next: ((waterPurchaseTransactionDTO: WaterPurchaseTransactionDTO) => {
        if (this.waterPurchaseTransaction) {
          this.waterPurchaseTransaction.rcCreditReqList = waterPurchaseTransactionDTO.rcCreditReqList;
          this.totalPendingAmount = waterPurchaseTransactionDTO.balanceAmount;
        }
        this.isRecording = false;
      }),
      complete: (() => {
        this.alertService.triggerAlert(AlertType.Success, "Trip Added Successfully !")
      })
    });
  }
  calculateAmount() {
    return this.waterService.getCalculatedAmount(this.purchaseParty?.customerId);
  }

  performPayment() {
    const dialogRef = this.dialog.open(PaymentModalComponent, { width: '250px', data: { paymentAmount: this.totalPendingAmount } })
    dialogRef.afterClosed().subscribe((customerPayment: CustomerPayment) => {
      if (customerPayment) {
        this.isRecording = true;
        this.waterService.addWaterPayment(this.purchaseParty?.customerId, customerPayment).subscribe((waterPurchaseTransactionDTO: WaterPurchaseTransactionDTO) => {
          if (this.waterPurchaseTransaction) {
            this.waterPurchaseTransaction.rcCreditReqList = waterPurchaseTransactionDTO.rcCreditReqList;
            this.totalPendingAmount = waterPurchaseTransactionDTO.balanceAmount;
          }
          this.isRecording = false;
          this.alertService.triggerAlert(AlertType.Success, "Payment processed successfully !")
        })
      }
    })
  }


  hasTransactions(): boolean {
    if (this.waterPurchaseTransaction && this.waterPurchaseTransaction.rcCreditReqList && this.waterPurchaseTransaction.rcCreditReqList.length > 0)
      return true;
    else
      return false;
  }
}
