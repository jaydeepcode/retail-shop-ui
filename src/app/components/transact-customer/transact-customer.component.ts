import { AfterViewInit, Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { MatTableDataSource } from '@angular/material/table';
import { ActivatedRoute } from '@angular/router';
import { catchError, firstValueFrom, interval, Observable, of, Subject, Subscription, takeUntil } from 'rxjs';
import { ActiveTripStatus, CustomerPayment, RcCreditReqDTO, WaterPurchasePartyDTO, WaterPurchaseTransactionDTO } from '../../model/model';
import { MotorStatusResponse, PumpSelectionResult, PumpStartTimeResponse } from '../../model/motor.types';
import { MotorControlService } from '../../services/MotorControlService';
import { WaterService } from '../../services/WaterService';
import { AlertService, AlertType } from '../../services/alert.service';
import { TripStateService } from '../../services/trip-state.service';
import { CustomerService } from '../../services/CustomerService';
import { AddTripConfirmationDialogComponent } from '../add-trip-confirmation-dialog/add-trip-confirmation-dialog.component';
import { PaymentModalComponent } from '../payment-modal/payment-modal.component';
import { PumpControlDialogComponent } from '../pump-control-dialog/pump-control-dialog.component';
import { Messages } from '../../constants/messages';

@Component({
  selector: 'app-transact-customer',
  templateUrl: './transact-customer.component.html',
  styleUrls: ['./transact-customer.component.scss']
})
export class TransactCustomerComponent implements OnInit, AfterViewInit, OnDestroy {
  public waterPurchaseTransaction: WaterPurchaseTransactionDTO | undefined;
  purchaseParty: WaterPurchasePartyDTO | undefined;
  customerName: string | undefined;
  isRecording: boolean = false;
  histGroupForm: FormGroup;
  displayedColumns: string[] = ['tripDateTime', 'creditAmount', 'depositAmount', 'balanceAmount', 'status', 'pumpUsed', 'duration', 'credBy'];
  historyColumns: string[] = ['tripDateTime', 'creditAmount', 'depositAmount', 'balanceAmount', 'pumpUsed', 'duration','credBy'];
  public dataSource = new MatTableDataSource<RcCreditReqDTO>([]); totalPendingAmount: number = 0;
  pendingTrip: number = 0;

  // Motor control properties
  insideMotorRunning = false;
  outsideMotorRunning = false;
  waterLevel: string = 'LOW';
  isMotorActionPending = false;
  isMotorStatusAvailable = false;  // New property to track ESP server availability

  private statusSubscription: Subscription | undefined;
  private pollingInterval = 5000; // 5 seconds

  // Countdown timer properties
  public tripCountdown: number = 0;
  private expectedEndTime: number = 0; // Calculated: startTime + expectedDuration in milliseconds
  private countdownInterval: any;
  private autoStopDialogRef: any = null; // MatDialogRef<PumpControlDialogComponent> | null
  private currentTripId: number | null = null; // Store trip ID for potential amount updates

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  private ngUnsubscribe$ = new Subject<void>();
  constructor(
    private waterService: WaterService,
    private alertService: AlertService,
    private fb: FormBuilder,
    private dialog: MatDialog,
    private activatedRoute: ActivatedRoute,
    private motorControlService: MotorControlService,
    private tripStateService: TripStateService,
    private customerService: CustomerService
  ) {
    this.histGroupForm = this.fb.group({
      historyMode: [false]
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
  }
  private initializeCustomerData(): void {
    if (this.waterPurchaseTransaction) {
      this.totalPendingAmount = this.waterPurchaseTransaction.balanceAmount;
      this.calculatePendingTrip();
      this.purchaseParty = this.waterPurchaseTransaction.waterPurchaseParty;
      this.customerName = this.waterPurchaseTransaction.customerName;
    }
  }

  private async checkAndRestoreActiveTrip(): Promise<void> {
    if (!this.purchaseParty?.customerId) {
      this.tripStateService.clearActiveTrip();
      return;
    }

    const activeTrip = this.tripStateService.getActiveTrip();
    if (activeTrip?.customerId === this.purchaseParty.customerId && activeTrip?.tripId) {
       this.restoreActiveTripState(activeTrip);
    } else {
      await this.checkBackendForActiveTrip();
    }
  }

  private checkBackendForActiveTrip(): Promise<void> {
    if (!this.purchaseParty?.customerId) return Promise.resolve();

    return firstValueFrom(
      this.waterService.getInProgressTrip(this.purchaseParty.customerId)
        .pipe(
          catchError(error => {
            console.error('Error fetching in-progress trip:', error);
            this.tripStateService.clearActiveTrip();
            return Promise.resolve(null);
          })
        )
    ).then(tripData => {
      if (tripData) {
        this.restoreActiveTripState(tripData);
      } else {
        this.tripStateService.clearActiveTrip();
      }
    });
  }

  private restoreActiveTripState(tripData: ActiveTripStatus): void {
    const pumpUsed = tripData.pumpUsed || 'inside';
    
    // Map backend response (tripStartTime) to startTime
    const startTime = tripData.tripStartTime ? new Date(tripData.tripStartTime) : tripData.startTime;
    
    // Store backend's startTime and expectedDurationSeconds in TripStateService
    this.tripStateService.setActiveTrip(
      tripData.tripId ?? 0,
      this.purchaseParty?.customerId || 0,
      pumpUsed as 'inside' | 'outside' | 'both',
      startTime,
      tripData.expectedDurationSeconds
    );

    // Start countdown from backend data
    if (startTime && tripData.expectedDurationSeconds) {
      const tripDataWithStartTime = {
        ...tripData,
        startTime: startTime
      };
      this.startCountdown(tripDataWithStartTime);
    }
  }

  private initializeHistoryMode(): void {
    this.histGroupForm.get('historyMode')?.valueChanges.subscribe(value => {
      if (value) {
        this.fetchAllTransactions(0, 5);
      }
    });
  }

  ngOnInit(): void {
    this.waterPurchaseTransaction = this.activatedRoute.snapshot.data['customerData'];

    this.initializeCustomerData();
    this.checkAndRestoreActiveTrip();
    this.initializeHistoryMode();
    this.startMotorStatusPolling();
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe$.next();
    this.ngUnsubscribe$.complete();
    this.stopMotorStatusPolling();
    this.clearCountdown();
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
          this.isMotorStatusAvailable = true;
          this.updatePumpStatus(response);
        },
        error: (error) => {
          console.error('Error fetching motor status:', error);
          this.isMotorStatusAvailable = false;
          this.insideMotorRunning = false;
          this.outsideMotorRunning = false;
          this.alertService.triggerAlert(AlertType.Error, Messages.MOTOR_SYSTEM_UNAVAILABLE);
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
    const activeTrip = this.tripStateService.getActiveTrip();
    console.log('Testing Active Trip:', activeTrip);  
    // Create an observable that either gets the pump start time or returns undefined
    const startTimeObservable = (activeTrip?.tripId ? 
      this.motorControlService.getPumpStartTime(activeTrip.tripId).pipe(
        catchError(error => {
          console.error('Error fetching pump start time:', error);
          this.alertService.triggerAlert(AlertType.Error, 'Failed to fetch pump start time');
          return of({ startTime: undefined });
        })
      ) : 
      of({ startTime: undefined })) as Observable<PumpStartTimeResponse>;

    // Handle the dialog opening and result processing
    firstValueFrom(startTimeObservable).then(startTimeResponse => {
      this.openPumpControlDialogWithData(startTimeResponse);
    });
  }

  private openPumpControlDialogWithData(startTimeResponse: PumpStartTimeResponse) {
    const dialogRef = this.dialog.open(PumpControlDialogComponent, {
      width: '600px',
      data: {
        insideStatus: this.insideMotorRunning ? 'ON' : 'OFF',
        outsideStatus: this.outsideMotorRunning ? 'ON' : 'OFF',
        waterLevel: this.waterLevel,
        tripStartTime: startTimeResponse?.startTime ? new Date(startTimeResponse.startTime) : undefined,
      }
    });

    dialogRef.afterClosed().subscribe(async (result: PumpSelectionResult) => {
      if (result) {
        try {
          // Get current pump states before changes
          const wasInsideRunning = this.insideMotorRunning;
          const wasOutsideRunning = this.outsideMotorRunning;

          // Wait for pump control to complete
          await this.handlePumpControl(result);

          // Now we can safely proceed with trip management
          const isStartingNewPump =
            (!wasInsideRunning && this.insideMotorRunning) || // Inside pump was started
            (!wasOutsideRunning && this.outsideMotorRunning); // Outside pump was started

          if (isStartingNewPump && !this.tripStateService.hasActiveTrip()) {
            // Starting pump(s) for a new trip
            this.performAction();
          } else if (this.tripStateService.hasActiveTrip() &&
            !this.insideMotorRunning && !this.outsideMotorRunning) {
            // Both pumps are now stopped and we have an active trip
            this.updateWaterTripTime();
          }
        } catch (error) {
          console.error('Error during pump control process:', error);
          this.alertService.triggerAlert(AlertType.Error, 'Failed to complete pump operation');
        }
      }
    });
  }

  getRunningPumpStartTime() {
    const activeTrip: ActiveTripStatus = this.tripStateService.getActiveTrip();

   return this.motorControlService.getPumpStartTime(activeTrip.tripId).subscribe({
      next: (response) => {
        return response.startTime ? new Date(response.startTime) : undefined;
      },
      error: (error) => {
        console.error('Error fetching pump start time:', error);
        this.alertService.triggerAlert(AlertType.Error, 'Failed to fetch pump start time');
      }
    })
  }

  updateWaterTripTime() {
    const activeTrip = this.tripStateService.getActiveTrip();
    if (!activeTrip?.tripId) return;

    this.isRecording = true;
    // Clear countdown when trip is stopped manually
    this.clearCountdown();
    
    this.waterService.updateWaterTripTime(
      this.purchaseParty?.customerId,
      activeTrip.tripId
    ).subscribe({
      next: ((rcCreditReqDTO: RcCreditReqDTO[] | null) => {
        if (rcCreditReqDTO && this.waterPurchaseTransaction) {
          this.waterPurchaseTransaction.rcCreditReqList = rcCreditReqDTO;
          this.tripStateService.clearActiveTrip();
          this.currentTripId = null; // Clear trip ID when trip is completed
        }
        this.isRecording = false;
      }),
      complete: (() => {
        this.alertService.triggerAlert(AlertType.Success, "Trip time updated successfully!")
      }),
      error: (error) => {
        this.isRecording = false;
        this.handleError(error);
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
      // Determine which pumps are being used
      const pumpUsed = this.insideMotorRunning && this.outsideMotorRunning ? 'both' :
        this.insideMotorRunning ? 'inside' : 'outside';

      // Immediately call addWaterTrip asynchronously (fire-and-forget)
      this.addWaterTripAsync(calculatedAmount, pumpUsed);
      
      // Show confirmation dialog (trip is already being created in background)
      const dialogRef = this.dialog.open(AddTripConfirmationDialogComponent, { data: { amount: calculatedAmount } });
      dialogRef.afterClosed().subscribe(result => {
        if (result) {
          // If user adjusted amount, update trip
          if (result.amount !== calculatedAmount && this.currentTripId) {
            this.updateTripAmount(result.amount);
          }
        }
      });
    });
  }

  private addWaterTripAsync(amount: number, pumpUsed: 'inside' | 'outside' | 'both'): void {
    // Fire and forget - don't wait for response
    this.waterService.addWaterTrip(this.purchaseParty?.customerId, amount, pumpUsed)
      .subscribe({
        next: async (waterPurchaseTransactionDTO: WaterPurchaseTransactionDTO | null) => {
          if (waterPurchaseTransactionDTO && this.waterPurchaseTransaction) {
            this.waterPurchaseTransaction.rcCreditReqList = waterPurchaseTransactionDTO.rcCreditReqList;
            this.totalPendingAmount = waterPurchaseTransactionDTO.balanceAmount;
            this.calculatePendingTrip();
            
            // Store trip ID for potential amount updates
            this.currentTripId = waterPurchaseTransactionDTO.purchaseId;
            
            // Fetch backend trip data to get startTime and expectedDurationSeconds
            if (this.purchaseParty?.customerId) {
              try {
                const tripData = await firstValueFrom(
                  this.waterService.getInProgressTrip(this.purchaseParty.customerId).pipe(
                    catchError(error => {
                      console.error('Error fetching in-progress trip after recording:', error);
                      return of(null);
                    })
                  )
                );

                if (tripData) {
                  // Map backend response (tripStartTime) to startTime
                  const startTime = tripData.tripStartTime ? new Date(tripData.tripStartTime) : tripData.startTime;
                  
                  // Update stored trip ID from backend if available
                  if (tripData.tripId) {
                    this.currentTripId = tripData.tripId;
                  }
                  
                  // Save trip state with backend values
                  this.tripStateService.setActiveTrip(
                    tripData.tripId ?? waterPurchaseTransactionDTO.purchaseId,
                    this.purchaseParty?.customerId || 0,
                    pumpUsed,
                    startTime,
                    tripData.expectedDurationSeconds
                  );

                  // Start countdown with backend data
                  const tripDataWithStartTime = {
                    ...tripData,
                    startTime: startTime
                  };
                  this.startCountdown(tripDataWithStartTime);
                } else {
                  // Fallback: save trip state without backend data
                  this.tripStateService.setActiveTrip(
                    waterPurchaseTransactionDTO.purchaseId,
                    this.purchaseParty?.customerId || 0,
                    pumpUsed
                  );
                }
              } catch (error) {
                console.error('Error fetching trip data after recording:', error);
                // Fallback: save trip state without backend data
                this.tripStateService.setActiveTrip(
                  waterPurchaseTransactionDTO.purchaseId,
                  this.purchaseParty?.customerId || 0,
                  pumpUsed
                );
              }
            }
            // Show success alert after trip is created
            this.alertService.triggerAlert(AlertType.Success, "Trip Added Successfully!");
          }
        },
        error: (error) => {
          console.error('Error creating trip asynchronously:', error);
          this.alertService.triggerAlert(AlertType.Error, 'Failed to create trip: ' + error.message);
          this.currentTripId = null;
        }
      });
  }

  private updateTripAmount(newAmount: number): void {
    if (!this.currentTripId || !this.purchaseParty?.customerId) {
      this.alertService.triggerAlert(AlertType.Error, 'Cannot update trip: Trip ID not available');
      return;
    }

    this.isRecording = true;
    this.waterService.updateTripAmount(this.purchaseParty.customerId, this.currentTripId, newAmount)
      .subscribe({
        next: (waterPurchaseTransactionDTO: WaterPurchaseTransactionDTO | null) => {
          if (waterPurchaseTransactionDTO && this.waterPurchaseTransaction) {
            this.waterPurchaseTransaction.rcCreditReqList = waterPurchaseTransactionDTO.rcCreditReqList;
            this.totalPendingAmount = waterPurchaseTransactionDTO.balanceAmount;
            this.calculatePendingTrip();
            this.alertService.triggerAlert(AlertType.Success, "Trip amount updated successfully!");
          }
          this.isRecording = false;
        },
        error: (error) => {
          this.isRecording = false;
          this.handleError(error);
        }
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

  // Countdown timer methods
  private startCountdown(tripData: ActiveTripStatus): void {
    // Clear any existing countdown
    this.clearCountdown();

    const startTimeValue = tripData.startTime || tripData.tripStartTime;
    if (!startTimeValue || !tripData.expectedDurationSeconds) {
      console.warn('Cannot start countdown: missing startTime or expectedDurationSeconds');
      return;
    }

    const startTime = new Date(startTimeValue).getTime();
    this.expectedEndTime = startTime + (tripData.expectedDurationSeconds * 1000);
    
    // Initial calculation
    this.updateCountdown();

    // Update countdown every second
    this.countdownInterval = setInterval(() => {
      this.updateCountdown();
    }, 1000);
  }

  private updateCountdown(): void {
    const now = new Date().getTime();
    const remainingSeconds = Math.max(0, Math.floor((this.expectedEndTime - now) / 1000));
    console.log('Remaining seconds:', remainingSeconds);
    this.tripCountdown = remainingSeconds;

    // Auto-stop dialog at 9 seconds
    if (remainingSeconds === 9 && !this.autoStopDialogRef) {
      this.showAutoStopDialog();
    }

    // Auto-stop at 0 seconds
    if (remainingSeconds === 0) {
      this.handleAutoStop();
    }
  }

  private clearCountdown(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.autoStopDialogRef) {
      this.autoStopDialogRef.close();
      this.autoStopDialogRef = null;
    }
    this.tripCountdown = 0;
    this.expectedEndTime = 0;
  }

  private showAutoStopDialog(): void {
    console.log('Showing auto-stop dialog with countdown:', this.tripCountdown);
    // Open auto-stop dialog at 9 seconds
    const dialogRef = this.dialog.open(PumpControlDialogComponent, {
      width: '600px',
      disableClose: true,
      data: {
        insideStatus: this.insideMotorRunning ? 'ON' : 'OFF',
        outsideStatus: this.outsideMotorRunning ? 'ON' : 'OFF',
        waterLevel: this.waterLevel,
        tripStartTime: this.tripStateService.getActiveTrip()?.startTime,
        autoStopMode: true,
        countdown: this.tripCountdown
      }
    });

    this.autoStopDialogRef = dialogRef;

    // Auto-close and stop after countdown reaches 0
    const autoStopCheck = setInterval(() => {
      if (this.tripCountdown <= 0) {
        clearInterval(autoStopCheck);
        if (this.autoStopDialogRef) {
          this.autoStopDialogRef.close();
          this.autoStopDialogRef = null;
        }
        //this.handleAutoStop();
      }
    }, 500);
  }

  private async handleAutoStop(): Promise<void> {
    this.clearCountdown();
    
    if (!this.tripStateService.hasActiveTrip()) {
      return;
    }

    // Backend handles pump stopping automatically
    // After 2-second delay, fetch latest customer data to refresh rcCreditReqList
    setTimeout(() => {
      if (this.purchaseParty?.customerId) {
        this.customerService.getTransactions(this.purchaseParty.customerId).subscribe({
          next: (waterPurchaseTransactionDTO: WaterPurchaseTransactionDTO) => {
            if (waterPurchaseTransactionDTO && this.waterPurchaseTransaction) {
              this.waterPurchaseTransaction.rcCreditReqList = waterPurchaseTransactionDTO.rcCreditReqList;
              this.totalPendingAmount = waterPurchaseTransactionDTO.balanceAmount;
              this.calculatePendingTrip();
            }
            // Clear the active trip state after refreshing data
            this.tripStateService.clearActiveTrip();
          },
          error: (error) => {
            console.error('Error fetching customer transactions after auto-stop:', error);
            // Clear the active trip state even if refresh fails
            this.tripStateService.clearActiveTrip();
          }
        });
      } else {
        // Clear the active trip state if no customer ID
        this.tripStateService.clearActiveTrip();
      }
    }, 2000);
  }
}
