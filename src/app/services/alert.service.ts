import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';


export enum AlertType  {
  Success,
  Error,
  Warning,
  Info
}

export interface Alert {
  type: AlertType,
  message: String
}

@Injectable({
  providedIn: 'root'
})
export class AlertService {
  private alertSubject = new Subject<Alert>();
  alertState$ = this.alertSubject.asObservable();

  constructor() { }
  triggerAlert(type: AlertType, message: string){
    this.alertSubject.next({type, message});
  }
}
