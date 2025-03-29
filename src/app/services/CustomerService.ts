import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CustomerProfile } from '../model/model';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class CustomerService {

  constructor(private apiService: ApiService) { }

  searchCustomers(customerName: string): Observable<CustomerProfile[]> {
    const params = { customerName: customerName};
    return this.apiService.getData<CustomerProfile[]>(`/customers/search`, params);
  }

  getTransactions(customerId: number): Observable<any> {
    const params = { customerId: customerId };
    return this.apiService.getData<any>(`/party/transactions`, params);
  }

  getRecentCustomers(): Observable<CustomerProfile[]> {
    return this.apiService.getData<CustomerProfile[]>(`/party/recent-customers`);
  }
}
