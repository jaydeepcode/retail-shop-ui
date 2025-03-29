import { Component, OnDestroy, OnInit } from '@angular/core';
import { Alert, AlertService, AlertType } from '../../services/alert.service';
import { fromEvent, merge, Subscription, take } from 'rxjs';

@Component({
  selector: 'app-global-alert',
  templateUrl: './global-alert.component.html',
  styleUrl: './global-alert.component.scss'
})
export class GlobalAlertComponent implements OnInit, OnDestroy {

  alert: Alert | null = null;
  alertSubscription: Subscription | undefined;
  private autoDismissTimeout: any; // Track timeout for auto-dismissing alerts
  AlertType: typeof AlertType = AlertType;
  userInteractionSub: Subscription | undefined;

  constructor(private alertService: AlertService) {
    this.alert = null;
  }

  ngOnInit(): void {
    this.alertSubscription = this.alertService.alertState$.subscribe((alert: Alert) => {
      // Clear existing timeouts/subscriptions
      this.clearAutoDismiss();
      this.clearUserInteractionListeners();

      this.alert = alert;
      if (alert.type === AlertType.Error || alert.type === AlertType.AutoLogout) {
        this.setupUserInteractionDismiss();
      } else {
        this.autoDismissTimeout = setTimeout(() => {
          this.alert = null;
        }, 2000);
      }
    })
  }

  clearUserInteractionListeners() {
    if (this.userInteractionSub) {
      this.userInteractionSub.unsubscribe();
      this.userInteractionSub = undefined;
    }
  }

  private clearAutoDismiss(): void {
    if (this.autoDismissTimeout) {
      clearTimeout(this.autoDismissTimeout);
      this.autoDismissTimeout = null;
    }
  }

  private setupUserInteractionDismiss(): void {
    // Listen to clicks, keypresses, and touch events
    const interactionEvents = merge(
      fromEvent(document, 'click'),
      fromEvent(document, 'keydown'),
      fromEvent(document, 'touchstart')
    ).pipe(take(1)); // Dismiss on first interaction

    this.userInteractionSub = interactionEvents.subscribe(() => {
      this.onDismiss();
    });
  }

  ngOnDestroy(): void {
    this.alertSubscription?.unsubscribe();
    this.clearAutoDismiss();
    this.clearUserInteractionListeners();
  }

  onDismiss() {
    this.alert = null;
    this.clearUserInteractionListeners(); // Cleanup listeners
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
      case AlertType.AutoLogout:
        return 'alert-info';
      default:
        return '';
    }
  }
}
