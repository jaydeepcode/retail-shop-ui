import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { WaterService } from '../../services/WaterService';
import { AlertService, AlertType } from '../../services/alert.service';
import { debounceTime, switchMap } from 'rxjs';

@Component({
  selector: 'app-water-purchase-register',
  templateUrl: './water-purchase-register.component.html',
  styleUrl: './water-purchase-register.component.scss'
})
export class WaterPurchaseRegisterComponent {
  registrationForm: FormGroup;
  readonly dialogRef = inject(MatDialogRef<WaterPurchaseRegisterComponent>);
  storageTypes: string[] = ['Tanker', 'Small Purchase'];

  constructor(private fb: FormBuilder,
    private waterPurchaseService: WaterService,
    private alertService: AlertService) {
    this.registrationForm = this.fb.group({
      customerName: ['', [Validators.required, Validators.minLength(3), Validators.pattern('^[a-zA-Z\\s\\-]+$')]],
      contactNum: ['', [Validators.required, Validators.pattern('^[0-9]{10}$')]], // Validates a 10-digit phone number 
      storageType: ['', Validators.required],
      capacity: ['', [Validators.required, Validators.pattern('^[0-9]*$')]], // Ensures only numbers are accepted 
      vehicleNumber: [''],
      address: [''],
      notes: ['']
    })

    // Add debounceTime to reduce the number of requests sent to the server 
    this.registrationForm?.get('contactNum')?.valueChanges
      .pipe(debounceTime(500), switchMap(value => this.waterPurchaseService.checkContact(value)))
      .subscribe(isRegistered => { if (isRegistered) { this.registrationForm?.get('contactNum')?.setErrors({ alreadyRegistered: true }); } });
  }

  onSubmit(): void {
    if (this.registrationForm.valid) {
      this.waterPurchaseService.registerParty(this.registrationForm.value)
        .subscribe({
          next: ((response: any) => {
            if(response.message == "Registration Successful"){
              this.alertService.triggerAlert(AlertType.Success, response.message);
              this.dialogRef.close();
            }
          }),
          error: (error: any) => console.error('Error during registration', error)
        })
    }
  }
}
