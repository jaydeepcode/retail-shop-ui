import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription, catchError, of, switchMap } from 'rxjs';
import {
  RechargeWorkItemResponse,
  SettlementLineResponse,
  TransactionResponse
} from '../model/recharge.models';
import { RechargeApiService } from '../services/recharge-api.service';
import { errorSentence } from '../services/recharge-error';

/**
 * Sorting out a failed recharge — artboard 5.
 *
 * ⚠ THE RESOLUTION HALF OF THIS SCREEN CANNOT BE BUILT YET, and that is the whole
 * reason it looks unfinished. Artboard 5 is almost entirely retry and refund:
 * `POST /recharge/recharges/{id}/retry` (#12) and `/refund` (#13) are two of the four
 * endpoints `design-api.md` §3.2 specifies and S3 did not build. So this screen ships
 * the read side — what failed, and how much of the customer's money is being held — and
 * leaves the two resolutions behind a disabled control naming what is missing. Inventing
 * a client-side approximation would mean posting the retry as a second sale, which is
 * precisely the invariant the screen exists to protect: the retry rides on the payment
 * already taken and never creates a new one.
 *
 * Artboard 5 drops the float strip, and `recharge.module.ts` already sets
 * `floatStrip: false` for this route: a failed recharge consumes no float (§7.2:370), so
 * there is nothing to attribute.
 *
 * ⚠ There is no "get one recharge" endpoint, so the row is found in
 * `/recharge/recharges/failures`. That is the only read that returns it — and it is also
 * why a recharge that has been resolved elsewhere simply drops out and says so.
 */
@Component({
  selector: 'app-failure',
  templateUrl: './failure.component.html',
  styleUrl: './failure.component.scss'
})
export class FailureComponent implements OnInit, OnDestroy {
  rechargeId: number | null = null;
  failure: RechargeWorkItemResponse | null = null;
  payment: TransactionResponse | null = null;

  loading = true;
  loadError = '';
  /** Distinct from an error: the id is not among the unresolved failures. */
  notAFailure = false;

  private readonly subscriptions = new Subscription();

  constructor(private route: ActivatedRoute, private api: RechargeApiService) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.route.paramMap
        .pipe(
          switchMap((params) => {
            const raw = params.get('failedId');
            this.rechargeId = raw && /^\d+$/.test(raw) ? Number(raw) : null;
            this.loading = true;
            this.loadError = '';
            this.notAFailure = false;
            this.failure = null;
            this.payment = null;
            if (this.rechargeId === null) {
              return of(null);
            }
            // Paged, so a deep tray needs more than the first page to find a row.
            return this.api.failures(0, 100).pipe(
              catchError((error) => {
                this.loadError = errorSentence(error);
                return of(null);
              })
            );
          })
        )
        .subscribe((page) => {
          this.loading = false;
          if (this.rechargeId === null) {
            this.notAFailure = true;
            return;
          }
          if (!page) {
            // Either a load error already set, or a bad id.
            this.notAFailure = !this.loadError;
            return;
          }
          const found = page.content.find((row) => row.rechargeId === this.rechargeId);
          if (!found) {
            this.notAFailure = true;
            return;
          }
          this.failure = found;
          this.loadPayment(found.paymentId);
        })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  /** How the customer paid, so the screen can say what is being held and in what form. */
  private loadPayment(paymentId: number): void {
    this.subscriptions.add(
      this.api
        .transaction(paymentId)
        .pipe(catchError(() => of(null)))
        .subscribe((transaction) => (this.payment = transaction))
    );
  }

  /**
   * What is being held against this failure.
   *
   * The recharge's own amount plus its surcharge — not the whole payment, which may have
   * covered a second recharge that went through perfectly well.
   */
  get held(): number {
    if (!this.failure) {
      return 0;
    }
    return (Math.round(this.failure.amount * 100) + Math.round(this.failure.surcharge * 100)) / 100;
  }

  /** The payment's own lines, for "the customer paid ₹349 in cash". */
  get paidBy(): SettlementLineResponse[] {
    return this.payment?.settlementLines ?? [];
  }

  methodWord(line: SettlementLineResponse): string {
    switch (line.method) {
      case 'CASH':
        return 'in cash';
      case 'UPI':
        return 'by UPI';
      case 'CREDIT':
        return 'on credit';
    }
  }
}
