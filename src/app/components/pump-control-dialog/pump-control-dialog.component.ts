import { Component, Inject, OnInit } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { PumpStatus, PumpSelectionResult } from '../../model/motor.types';
import { AuthService } from '../../services/auth.service';
import { BaseDialogComponent } from '../shared/base-dialog.component';

interface PumpControlData {
  insideStatus: PumpStatus;
  outsideStatus: PumpStatus;
  waterLevel: string;
}

@Component({
  selector: 'app-pump-control-dialog',
  templateUrl: './pump-control-dialog.component.html',
  styleUrls: ['./pump-control-dialog.component.scss']
})
export class PumpControlDialogComponent extends BaseDialogComponent implements OnInit {
  // Track selected pumps status
  selectedPumps = {
    inside: false,
    outside: false
  };

  constructor(
    dialogRef: MatDialogRef<PumpControlDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PumpControlData,
    authService: AuthService
  ) {
    super(dialogRef, authService);
  }

  ngOnInit() {
    // Pre-select both pumps if both are OFF
    if (this.data.insideStatus === 'OFF' && this.data.outsideStatus === 'OFF') {
      this.selectedPumps.inside = true;
      this.selectedPumps.outside = true;
    }
  }

  // Toggle pump selection
  togglePump(pump: 'inside' | 'outside'): void {
    if (this.canTogglePump(pump)) {
      this.selectedPumps[pump] = !this.selectedPumps[pump];
    }
  }

  // Check if a pump can be toggled based on current state
  canTogglePump(pump: 'inside' | 'outside'): boolean {
    const pumpStatus = pump === 'inside' ? this.data.insideStatus : this.data.outsideStatus;
    
    // If this pump is running, it can always be selected for stopping
    if (pumpStatus === 'ON') {
      return true;
    }
    
    // If the other pump is running, this pump cannot be started
    const otherPumpStatus = pump === 'inside' ? this.data.outsideStatus : this.data.insideStatus;
    return otherPumpStatus === 'OFF';
  }

  // Check if a pump is currently running
  isPumpRunning(pump: 'inside' | 'outside'): boolean {
    return pump === 'inside' ? 
      this.data.insideStatus === 'ON' : 
      this.data.outsideStatus === 'ON';
  }

  // Get the action text (Start/Stop) for the confirm button
  getActionText(): string {
    const anyRunning = Object.entries(this.selectedPumps)
      .some(([pump, isSelected]) => isSelected && this[`isPumpRunning`](pump as 'inside' | 'outside'));
    
    return anyRunning ? 'Stop' : 'Start';
  }

  // Confirm the pump operation
  onConfirm(): void {
    const result: PumpSelectionResult = {
      inside: this.getResultStatus('inside'),
      outside: this.getResultStatus('outside')
    };
    this.dialogRef.close(result);
  }

  // Get the final status for each pump
  private getResultStatus(pump: 'inside' | 'outside'): PumpStatus {
    const currentStatus = pump === 'inside' ? this.data.insideStatus : this.data.outsideStatus;
    const isSelected = this.selectedPumps[pump];

    // If pump is not selected, maintain current status
    if (!isSelected) {
      return currentStatus;
    }

    // If pump is running and selected, stop it
    if (currentStatus === 'ON') {
      return 'OFF';
    }

    // If pump is stopped and selected, start it
    return 'ON';
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  // Check if any pump is selected
  anyPumpSelected(): boolean {
    return this.selectedPumps.inside || this.selectedPumps.outside;
  }
}
