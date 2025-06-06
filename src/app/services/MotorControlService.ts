// This service handles the communication with the backend for motor control operations.
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class MotorControlService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  toggleMotorStatus(action: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/motor/pump`, { action: action });
  }

  getMotorStatus(): Observable<any> {
    return this.http.get(`${this.baseUrl}/motor/status`);
  }
}