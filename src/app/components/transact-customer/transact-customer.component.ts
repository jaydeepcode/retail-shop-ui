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
import { PumpControlDialogComponent } from '../pump-control-dialog/pump-control-dialog.component';
import { MotorControlService } from '../../services/MotorControlService';
import { catchError, firstValueFrom, interval, Subject, Subscription, takeUntil } from 'rxjs';
import { PumpStatus, PumpSelectionResult, MotorStatusResponse } from '../../model/motor.types';

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

  // Motor control properties
  insideMotorRunning = false;
  outsideMotorRunning = false;
  waterLevel: string = 'LOW';
  isMotorActionPending = false;

  private statusSubscription: Subscription | undefined;
  private pollingInterval = 5000; // 5 seconds

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  private ngUnsubscribe$ = new Subject<void>();

  constructor(
    private waterService: WaterService,
    private alertService: AlertService,
    private fb: FormBuilder,
    private dialog: MatDialog,
    private activatedRoute: ActivatedRoute,
    private motorControlService: MotorControlService
  ) {
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

  private updatePumpStatus(status: MotorStatusResponse): void {
    this.insideMotorRunning = status.pump_inside.status === 'ON';
    this.outsideMotorRunning = status.pump_outside.status === 'ON';
    this.waterLevel = status.water_level;
  }

  checkMotorStatus() {
    this.motorControlService.getMotorStatus()
      .subscribe({
        next: (response) => {
          this.updatePumpStatus(response);
        },
        error: (error) => {
          console.error('Error fetching motor status:', error);
          this.insideMotorRunning = false;
          this.outsideMotorRunning = false;
          this.alertService.triggerAlert(AlertType.Error, 'Failed to fetch pump status');
        }
      });
  }

  async handlePumpControl(result: PumpSelectionResult) {
    this.isMotorActionPending = true;
    try {
      // Handle inside pump first if it needs to be started
      const currentInsideStatus = this.insideMotorRunning ? 'ON' : 'OFF';
      if (result.inside !== currentInsideStatus) {
        const action = result.inside === 'ON' ? 'start' : 'stop';
        await firstValueFrom(this.motorControlService.toggleMotorStatus(action, 'inside'));

        const status = await firstValueFrom(this.motorControlService.getMotorStatus());
        this.updatePumpStatus(status);

        // If starting both pumps, wait 5 seconds before starting the second one
        if (action === 'start' && result.outside === 'ON' && !this.outsideMotorRunning) {
          this.alertService.triggerAlert(
            AlertType.Info,
            'Waiting 5 seconds before starting second pump...'
          );
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      // Handle outside pump
      if (result.outside !== (this.outsideMotorRunning ? 'ON' : 'OFF')) {
        const action = result.outside === 'ON' ? 'start' : 'stop';
        // Toggle the pump state
        await firstValueFrom(this.motorControlService.toggleMotorStatus(action, 'outside'));
        // Get latest status after toggle
        const status = await firstValueFrom(this.motorControlService.getMotorStatus());
        this.updatePumpStatus(status);
      }

      this.isMotorActionPending = false;
      this.alertService.triggerAlert(
        AlertType.Success,
        'Pump status updated successfully!'
      );
    } catch (error) {
      console.error('Error updating pump status:', error);
      this.isMotorActionPending = false;
      this.alertService.triggerAlert(
        AlertType.Error,
        'Error updating pump status'
      );
      // Get latest status in case of error to ensure UI is in sync
      try {
        const status = await firstValueFrom(this.motorControlService.getMotorStatus());
        this.updatePumpStatus(status);
      } catch (statusError) {
        console.error('Failed to get status after error:', statusError);
      }
    }
  }

  openPumpControlDialog() {
    const dialogRef = this.dialog.open(PumpControlDialogComponent, {
      width: '600px',
      data: {
        insideStatus: this.insideMotorRunning ? 'ON' : 'OFF',
        outsideStatus: this.outsideMotorRunning ? 'ON' : 'OFF',
        waterLevel: this.waterLevel
      }
    });

    dialogRef.afterClosed().subscribe((result: PumpSelectionResult) => {
      if (result) {
        this.handlePumpControl(result);
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
