import { Component, Inject, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { debounceTime, switchMap } from 'rxjs';
import { CustomerProfile, WaterPurchasePartyDTO } from '../../model/model';
import { WaterService } from '../../services/WaterService';
import { AlertService, AlertType } from '../../services/alert.service';

@Component({
  selector: 'app-water-purchase-register',
  templateUrl: './water-purchase-register.component.html',
  styleUrl: './water-purchase-register.component.scss'
})
export class WaterPurchaseRegisterComponent {
  registrationForm: FormGroup ;
  readonly dialogRef = inject(MatDialogRef<WaterPurchaseRegisterComponent>);
  storageTypes: string[] = ['Tanker', 'Small Purchase'];
  isEditMode: boolean;

  constructor(private fb: FormBuilder,
    private waterPurchaseService: WaterService,
    private alertService: AlertService,
    @Inject(MAT_DIALOG_DATA) public customerProfile: CustomerProfile) {
    this.isEditMode = !!customerProfile;
     this.registrationForm = this.getRegistrationForm(undefined, undefined);
    if (this.isEditMode) {
      this.waterPurchaseService.getPartyDetails(customerProfile.custId).subscribe({
        next: (waterPurchaseParty: WaterPurchasePartyDTO) => {
          this.registrationForm = this.getRegistrationForm(customerProfile, waterPurchaseParty)
        }
      });
    }

    // Add debounceTime to reduce the number of requests sent to the server 
    this.registrationForm?.get('contactNum')?.valueChanges
      .pipe(debounceTime(500), switchMap(value => this.waterPurchaseService.checkContact(value)))
      .subscribe(isRegistered => { if (isRegistered) { this.registrationForm?.get('contactNum')?.setErrors({ alreadyRegistered: true }); } });
  }

  getRegistrationForm(customerProfile: CustomerProfile|undefined, waterPurchaseParty: WaterPurchasePartyDTO|undefined): FormGroup<any> {
    return this.fb.group({
      customerId: [customerProfile ? customerProfile.custId : '', [Validators.required]],
      customerName: [customerProfile ? customerProfile.customerName : '', [Validators.required, Validators.minLength(3), Validators.pattern('^[a-zA-Z\\s\\-]+$')]],
      contactNum: [customerProfile ? customerProfile.contactNum : '', [Validators.required, Validators.pattern('^[0-9]{10}$')]], // Validates a 10-digit phone number 
      storageType: [waterPurchaseParty ? waterPurchaseParty.storageType : '', Validators.required],
      capacity: [waterPurchaseParty ? waterPurchaseParty.capacity : '', [Validators.required, Validators.pattern('^[0-9]*$')]], // Ensures only numbers are accepted 
      vehicleNumber: [waterPurchaseParty ? waterPurchaseParty.vehicleNumber : ''],
      address: [waterPurchaseParty ? waterPurchaseParty.address : ''],
      notes: ['']
    })
  }

  onSubmit(): void {
    if (this.registrationForm.valid) {
      const operation = this.isEditMode ? this.waterPurchaseService.updateParty(this.registrationForm.get('customerId')?.value,this.registrationForm.value):
      this.waterPurchaseService.registerParty(this.registrationForm.value);
      
      operation.subscribe({
          next: ((response: any) => {
            if (response.message == "Registration Successful") {
              this.alertService.triggerAlert(AlertType.Success, response.message);
              this.dialogRef.close();
            }
          }),
          error: (error: any) => console.error('Error during registration', error)
        })
    }
  }
}
