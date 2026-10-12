import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { AppModule } from '../../app.module';

import { WaterPurchaseRegisterComponent } from './water-purchase-register.component';

describe('WaterPurchaseRegisterComponent', () => {
  let component: WaterPurchaseRegisterComponent;
  let fixture: ComponentFixture<WaterPurchaseRegisterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppModule],
      providers: [
        provideRouter([]),
        provideHttpClientTesting(),
        { provide: MatDialogRef, useValue: { close: () => undefined } },
        // Injected as the customer profile the dialog was opened for.
        { provide: MAT_DIALOG_DATA, useValue: {} }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WaterPurchaseRegisterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
