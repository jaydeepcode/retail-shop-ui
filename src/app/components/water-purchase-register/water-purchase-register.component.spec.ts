import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WaterPurchaseRegisterComponent } from './water-purchase-register.component';

describe('WaterPurchaseRegisterComponent', () => {
  let component: WaterPurchaseRegisterComponent;
  let fixture: ComponentFixture<WaterPurchaseRegisterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WaterPurchaseRegisterComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WaterPurchaseRegisterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
