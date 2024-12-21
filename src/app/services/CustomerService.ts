import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CustomerProfile } from '../model/model';

@Injectable({
  providedIn: 'root'
})
export class CustomerService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  searchCustomers(customerName: string): Observable<CustomerProfile[]> {
    return this.http.get<CustomerProfile[]>(`${this.apiUrl}/customers/search`, { params: { customerName } });
  }

  getTransactions(customerId: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/party/transactions`, { params: { customerId } });
  }

  getRecentCustomers(): Observable<CustomerProfile[]> {
    return this.http.get<CustomerProfile[]>(`${this.apiUrl}/party/recent-customers`);
  }
}
