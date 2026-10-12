import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { AppModule } from '../../app.module';

import { AddTripConfirmationDialogComponent } from './add-trip-confirmation-dialog.component';

describe('AddTripConfirmationDialogComponent', () => {
  let component: AddTripConfirmationDialogComponent;
  let fixture: ComponentFixture<AddTripConfirmationDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppModule],
      providers: [
        provideRouter([]),
        provideHttpClientTesting(),
        { provide: MatDialogRef, useValue: { close: () => undefined } },
        // The constructor builds its form from data.amount, so it cannot be empty.
        { provide: MAT_DIALOG_DATA, useValue: { amount: 100 } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AddTripConfirmationDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('seeds the amount field from the data it was opened with', () => {
    expect(component.confirmationForm.get('amount')?.value).toBe(100);
  });
});
