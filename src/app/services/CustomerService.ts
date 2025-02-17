import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CustomerProfile } from '../model/model';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class CustomerService {
  private apiUrl = environment.apiUrl;

  constructor(private apiService: ApiService) { }

  searchCustomers(customerName: string): Observable<CustomerProfile[]> {
    const params = { customerName: customerName};
    return this.apiService.getData<CustomerProfile[]>(`${this.apiUrl}/customers/search`, params);
  }

  getTransactions(customerId: number): Observable<any> {
    const params = { customerId: customerId };
    return this.apiService.getData<any>(`${this.apiUrl}/party/transactions`, params);
  }

  getRecentCustomers(): Observable<CustomerProfile[]> {
    return this.apiService.getData<CustomerProfile[]>(`${this.apiUrl}/party/recent-customers`);
  }
}
