import { Component } from '@angular/core';
import { CustomerService } from '../../services/CustomerService';
import { CustomerProfile, RcCreditReqDTO, WaterPurchasePartyDTO, WaterPurchaseTransactionDTO } from '../../model/model';
import { WaterService } from '../../services/WaterService';
import { AlertService, AlertType } from '../../services/alert.service';

@Component({
  selector: 'app-transact-customer',
  templateUrl: './transact-customer.component.html',
  styleUrl: './transact-customer.component.scss'
})
export class TransactCustomerComponent {

  public waterPurchaseTransaction: WaterPurchaseTransactionDTO | undefined;
  purchaseParty: WaterPurchasePartyDTO | undefined;
  customerName: string | undefined;
  isRecording:boolean = false;
  totalPendingAmount:number = 0;
  constructor(private customerService: CustomerService, 
    private waterService: WaterService, private alertService:AlertService) { }

  handleCustomer(profile: CustomerProfile) {
    this.customerService.getTransactions(profile.custId).subscribe((data: WaterPurchaseTransactionDTO) => {
      this.waterPurchaseTransaction = data;
      this.totalPendingAmount = data.rcCreditReqList[0].balance * -1;
      this.purchaseParty = data.waterPurchaseParty;
      this.customerName = profile.custName;
    })
  }

  performAction() {
    this.isRecording = true;
    this.waterService.addWaterTrip(this.purchaseParty?.customerId).subscribe((tripDetails: RcCreditReqDTO[]) => {
      if (this.waterPurchaseTransaction) {
          this.waterPurchaseTransaction.rcCreditReqList = tripDetails;
          this.totalPendingAmount = tripDetails[0].balance * -1;
      }
       this.isRecording = false; 
    }, null, (() => {
      this.alertService.triggerAlert(AlertType.Success, "Trip Added Successfully !")
    }))
  }

  performPayment(){
    this.isRecording = true;
    this.waterService.addWaterPayment(this.purchaseParty?.customerId,this.totalPendingAmount).subscribe((tripDetails: RcCreditReqDTO[]) => {
      if (this.waterPurchaseTransaction) {
        this.waterPurchaseTransaction.rcCreditReqList = tripDetails;
        this.totalPendingAmount = tripDetails[0].balance * -1;
    }
      this.isRecording = false; 
      this.alertService.triggerAlert(AlertType.Success, "Payment processed successfully !")
    })
  }
}
