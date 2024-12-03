import { Component, OnDestroy, OnInit } from '@angular/core';
import { Alert, AlertService, AlertType } from '../../services/alert.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-global-alert',
  templateUrl: './global-alert.component.html',
  styleUrl: './global-alert.component.scss'
})
export class GlobalAlertComponent implements OnInit, OnDestroy {
  alert: Alert | null = null;
  alertSubscription: Subscription | undefined;

  constructor(private alertService: AlertService) { }

  ngOnInit(): void {
    this.alertSubscription = this.alertService.alertState$.subscribe((alert: Alert) => {
      this.alert = alert;
      setTimeout(() => { this.alert = null }, 2000);
    })
  }

  ngOnDestroy(): void {
    if (this.alertSubscription) {
      this.alertSubscription.unsubscribe();
    }
  }

  get alertClass(): string {
    if (!this.alert) return "";
    switch (this.alert.type) {
      case AlertType.Success:
        return 'alert-success';
      case AlertType.Error:
        return 'alert-error';
      case AlertType.Info:
        return 'alert-info';
      case AlertType.Warning:
        return 'alert-warning';
      default: 
        return '';
    }
  }
}
