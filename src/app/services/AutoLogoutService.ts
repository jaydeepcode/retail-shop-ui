import { Injectable, OnDestroy } from "@angular/core";
import { debounceTime, from, fromEvent, merge, tap, timer } from "rxjs";
import { UserDetailService } from "./UserDetailService";
import { AuthService } from "./auth.service";
import { AlertService, AlertType } from "./alert.service";

@Injectable({ providedIn: 'root' })
export class AutoLogoutService implements OnDestroy {
    timerSubscription: any;
    eventSubscription: any;
    private readonly INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes

    constructor(private userDetailService: UserDetailService, private authService: AuthService, private alertService: AlertService) {
       this.authService.isLoggedIn.subscribe((isLoggedIn) => {
            if (isLoggedIn) {
                this.initInactivityTimer();
            }else {
                this.unsubscribeServices();
            }
        }
        );
        console.log('AutoLogoutService initialized');
    }

    initInactivityTimer() {
        const activityEvent = merge(
            fromEvent(document, 'mousemove'),
            fromEvent(document, 'keydown'),
            fromEvent(document, 'click'),
            fromEvent(document, 'scroll')
        ).pipe(
            debounceTime(1000)
        );
        this.eventSubscription = activityEvent.subscribe(() => { this.resetTimer() });
    }

    resetTimer() {
        console.log('Resetting timer');
        if (this.timerSubscription) {
            this.timerSubscription.unsubscribe();
        }
        this.startTimer();
    }

    startTimer() {
        console.log('Starting timer');
        this.timerSubscription = timer(this.INACTIVITY_TIMEOUT).pipe(
            tap(() => { this.logout() })
        ).subscribe();
    }

    logout() {
        console.log('Logging out due to inactivity');
        this.alertService.triggerAlert(AlertType.AutoLogout, "Logging out due to inactivity !")
        this.userDetailService.setUserDetail(null);
        this.authService.logout();
    }

    unsubscribeServices() {
        this.eventSubscription.unsubscribe();
        this.timerSubscription.unsubscribe();
    }

    ngOnDestroy(): void {
        this.unsubscribeServices();
    }
}