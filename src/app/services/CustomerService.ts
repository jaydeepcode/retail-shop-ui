import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class CustomerService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  searchCustomers(customerName: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/customers/search`, { params: { customerName } });
  }

  getTransactions(customerId: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/party/transactions`, { params: { customerId } });
  }
}
