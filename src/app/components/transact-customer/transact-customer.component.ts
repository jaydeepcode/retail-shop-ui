import { AfterViewInit, Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { MatTableDataSource } from '@angular/material/table';
import { ActivatedRoute } from '@angular/router';
import { CustomerPayment, RcCreditReqDTO, WaterPurchasePartyDTO, WaterPurchaseTransactionDTO } from '../../model/model';
import { WaterService } from '../../services/WaterService';
import { AlertService, AlertType } from '../../services/alert.service';
import { AddTripConfirmationDialogComponent } from '../add-trip-confirmation-dialog/add-trip-confirmation-dialog.component';
import { PaymentModalComponent } from '../payment-modal/payment-modal.component';
import { MotorControlService } from '../../services/MotorControlService';
import { catchError, interval, Subject, Subscription, takeUntil } from 'rxjs';

@Component({
  selector: 'app-transact-customer',
  templateUrl: './transact-customer.component.html',
  styleUrl: './transact-customer.component.scss'
})
export class TransactCustomerComponent implements OnInit, AfterViewInit, OnDestroy {

  public waterPurchaseTransaction: WaterPurchaseTransactionDTO | undefined;
  purchaseParty: WaterPurchasePartyDTO | undefined;
  customerName: string | undefined;
  isRecording: boolean = false;
  histGroupForm: FormGroup;
  displayedColumns: string[] = ['tripDateTime', 'creditAmount', 'depositAmount', 'balanceAmount', 'credBy'];
  public dataSource = new MatTableDataSource<RcCreditReqDTO>([]);
  totalPendingAmount: number = 0;
  pendingTrip: number = 0;

  motorRunning = false;
  isMotorActionPending = false;

  private statusSubscription: Subscription | undefined;
  private pollingInterval = 5000; // 5 seconds

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  private ngUnsubscribe$ = new Subject<void>();

  constructor(private waterService: WaterService, private alertService: AlertService,
    private fb: FormBuilder,
    private dialog: MatDialog,
    private activatedRoute: ActivatedRoute,
    private motorControlService: MotorControlService) {
    this.histGroupForm = this.fb.group({
      historyMode: [false]
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
  }

  ngOnInit(): void {
    this.waterPurchaseTransaction = this.activatedRoute.snapshot.data['customerData'];
    if (this.waterPurchaseTransaction) {
      this.totalPendingAmount = this.waterPurchaseTransaction.balanceAmount;
      this.calculatePendingTrip();
      this.purchaseParty = this.waterPurchaseTransaction.waterPurchaseParty;
      this.customerName = this.waterPurchaseTransaction.customerName;
    }

    // Subscribe to changes in the toggle form control
    this.histGroupForm.get('historyMode')?.valueChanges.subscribe(value => {
      if (value) {
        this.fetchAllTransactions(0, 5); // Fetch all transactions only when the toggle is turned on 
      }
    });

    this.startMotorStatusPolling();
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe$.next();
    this.ngUnsubscribe$.complete();
    this.stopMotorStatusPolling();
  }

  stopMotorStatusPolling(): void {
    if (this.statusSubscription) {
      this.statusSubscription.unsubscribe();
      this.statusSubscription = undefined;
    }
  }


  startMotorStatusPolling(): void {
    this.stopMotorStatusPolling(); // Clear any existing subscription

    this.statusSubscription = interval(this.pollingInterval)
      .pipe(
        takeUntil(this.ngUnsubscribe$)
      )
      .subscribe(() => {
        this.checkMotorStatus();
      });

    // Initial check
    this.checkMotorStatus();
  }
  checkMotorStatus() {
    this.motorControlService.getMotorStatus()
      .pipe(
        catchError(error => {
          console.error('Error fetching motor status:', error);
          this.motorRunning = false;
          throw error;
        })
      )
      .subscribe({
        next: (response) => {
          const newStatus = response.status === 'ON';
          if (this.motorRunning !== newStatus) {
            this.motorRunning = newStatus;
            // Optionally notify users about status change
            this.alertService.triggerAlert(
              AlertType.Info, 
              `Motor status changed to ${newStatus ? 'running' : 'stopped'}`
            );
          }
        }
      });
  }

  toggleMotor() {
    this.isMotorActionPending = true;
    const newStatus = this.motorRunning ? 'stop' : 'start';;

    this.motorControlService.toggleMotorStatus(newStatus).subscribe({
      next: (response) => {
        this.motorRunning = response.status == 'ON';
        this.isMotorActionPending = false;
        this.alertService.triggerAlert(AlertType.Success, `Motor ${this.motorRunning ? 'started' : 'stopped'} successfully!`);
      },
      error: (error) => {
        this.motorRunning = false;
        console.error('Error toggling motor:', error);
        this.isMotorActionPending = false;
        this.alertService.triggerAlert(AlertType.Error, `Occured error while starting/stopping motor !`);
      }
    });
  }

  calculatePendingTrip() {
    let capacity = this.waterPurchaseTransaction?.waterPurchaseParty?.capacity;
    if (capacity) {
      let perUnitPrice = Math.floor(capacity / 500) * 40;
      this.pendingTrip = this.totalPendingAmount / perUnitPrice;
    } else {
      this.pendingTrip = 0;
    }
  }

  fetchAllTransactions(page: number, size: number) {
    this.setLoadingState(true);
    this.waterService.getAllTransactions(this.purchaseParty!.customerId, page, size).subscribe({
      next: ((response) => {
        this.setLoadingState(false);
        this.dataSource.data = response.content;
        this.paginator.length = response.totalElements
      }),
      error: err => this.handleError(err)
    });
  }

  performAction() {
    this.calculateAmount().subscribe(calculatedAmount => {
      const dialogRef = this.dialog.open(AddTripConfirmationDialogComponent, { data: { amount: calculatedAmount } });
      dialogRef.afterClosed().subscribe(result => { if (result) { this.confirmTrip(result.amount); } });
    });

  }

  confirmTrip(amount: number) {
    this.isRecording = true;
    this.waterService.addWaterTrip(this.purchaseParty?.customerId, amount).subscribe({
      next: ((waterPurchaseTransactionDTO: WaterPurchaseTransactionDTO) => {
        if (this.waterPurchaseTransaction) {
          this.waterPurchaseTransaction.rcCreditReqList = waterPurchaseTransactionDTO.rcCreditReqList;
          this.totalPendingAmount = waterPurchaseTransactionDTO.balanceAmount;
          this.calculatePendingTrip()
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
            this.calculatePendingTrip()
          }
          this.isRecording = false;
          this.alertService.triggerAlert(AlertType.Success, "Payment processed successfully !")
        })
      }
    })
  }

  setLoadingState(isLoading: boolean) { this.isRecording = isLoading; }

  onPageChange(event: PageEvent) {
    this.fetchAllTransactions(event.pageIndex, event.pageSize);
  }
  handleError(error: any) {
    this.setLoadingState(false);
    this.alertService.triggerAlert(AlertType.Error, "An error occurred: " + error.message);
  }

  hasTransactions(): boolean {
    if (this.waterPurchaseTransaction && this.waterPurchaseTransaction.rcCreditReqList && this.waterPurchaseTransaction.rcCreditReqList.length > 0)
      return true;
    else
      return false;
  }
}
