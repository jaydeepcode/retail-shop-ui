import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AppModule } from '../../app.module';

import { TransactCustomerComponent } from './transact-customer.component';

describe('TransactCustomerComponent', () => {
  let component: TransactCustomerComponent;
  let fixture: ComponentFixture<TransactCustomerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppModule],
      providers: [
        provideRouter([]),
        provideHttpClientTesting(),
        {
          // The route resolves customerData before this screen is shown
          // (app.routes.ts), so the snapshot has to carry it here.
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { customerData: {} }, paramMap: { get: () => '1' } } }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TransactCustomerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
