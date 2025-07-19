// This service handles the communication with the backend for motor control operations.
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { environment } from '../../environments/environment';
import { MotorStatusResponse, PumpStartTimeResponse } from '../model/motor.types';

@Injectable({
  providedIn: 'root'
})
export class MotorControlService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  toggleMotorStatus(action: 'start' | 'stop', pump: 'inside' | 'outside'): Observable<MotorStatusResponse> {
    const url = `${this.baseUrl}/api/motor/pump/${pump}/${action}`;
    return this.http.post<MotorStatusResponse>(url, {});
  }

  getMotorStatus(): Observable<MotorStatusResponse> {
    const url = `${this.baseUrl}/api/motor/status`;
    return this.http.get<MotorStatusResponse>(url);
  }

  getPumpStartTime(tripId: number|undefined): Observable<PumpStartTimeResponse> {
    const url = `${this.baseUrl}/api/motor/trip-time/${tripId}`;
    return this.http.get<PumpStartTimeResponse>(url);
  }
}