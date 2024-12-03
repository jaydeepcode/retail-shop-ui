import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TransactCustomerComponent } from './transact-customer.component';

describe('TransactCustomerComponent', () => {
  let component: TransactCustomerComponent;
  let fixture: ComponentFixture<TransactCustomerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransactCustomerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TransactCustomerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
