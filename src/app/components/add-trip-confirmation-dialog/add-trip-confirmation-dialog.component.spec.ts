import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AddTripConfirmationDialogComponent } from './add-trip-confirmation-dialog.component';

describe('AddTripConfirmationDialogComponent', () => {
  let component: AddTripConfirmationDialogComponent;
  let fixture: ComponentFixture<AddTripConfirmationDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddTripConfirmationDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AddTripConfirmationDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
