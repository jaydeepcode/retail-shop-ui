import { OnDestroy, Injectable, Directive } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { AuthService } from '../../services/auth.service';
import { Subscription } from 'rxjs';

@Directive()
export abstract class BaseDialogComponent implements OnDestroy {
  private authSubscription: Subscription;

  constructor(
    protected dialogRef: MatDialogRef<any>,
    protected authService: AuthService
  ) {
    this.authSubscription = this.authService.isLoggedIn.subscribe(isLoggedIn => {
      if (!isLoggedIn) {
        // Close the dialog if user gets logged out
        this.dialogRef.close();
      }
    });
  }

  ngOnDestroy() {
    if (this.authSubscription) {
      this.authSubscription.unsubscribe();
    }
  }
}
