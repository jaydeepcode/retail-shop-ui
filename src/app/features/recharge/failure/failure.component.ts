import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, Subscription, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import {
  CreditCustomerResponse,
  RechargeWorkItemResponse,
  RefundRechargeRequest,
  RefundResponse,
  ResidualMode,
  RetryRechargeRequest,
  RetryRechargeResponse,
  SettlementLineResponse,
  SettlementMethod,
  TransactionResponse
} from '../model/recharge.models';
import { RechargeApiService } from '../services/recharge-api.service';
import {
  availableRefundModes,
  errorSentence,
  isAlreadyResolved
} from '../services/recharge-error';

/** Which resolution the staff member is filling in. One at a time. */
type Panel = 'none' | 'retry' | 'refund';

/** Where a lower retry's difference, or a refund, is heading. */
type Direction = 'same' | 'lower' | 'higher';

/**
 * Sorting out a failed recharge — artboard 5.
 *
 * ⚠ THE RESOLUTION HALF IS LIVE NOW, and the long comment that used to sit here saying it
 * could not be built is gone with it. `POST /recharge/recharges/{id}/retry` (#12) and
 * `/refund` (#13) are both on `main` (`RechargeController.java:465` and `:505`), so the
 * two disabled buttons and the paragraph telling staff "both need endpoints the counter
 * slice did not build" were wrong, visible, and being read at the counter.
 *
 * What has NOT changed is the invariant that kept them disabled rather than approximated:
 * a retry rides on the payment already taken and never creates a second one. That is
 * enforced in `RechargeFailureResolutionService`, and this screen does not reimplement it —
 * it posts the face value and lets the server settle the difference in the same
 * transaction (§3.3: "which is what keeps it in one transaction").
 *
 * ⚠ Three refusals this screen is built to make IMPOSSIBLE rather than to report:
 *
 *   1. `UNSETTLED_DIFFERENCE`. Exactly one of `differenceSettlement` and `topUp` is
 *      allowed, decided by the direction of the amount change, and on an equal-amount
 *      retry neither is. The panel asks for whichever one the typed amount implies and
 *      sends nothing else.
 *   2. A partial refund. `REFUNDED` is terminal, so a remainder would sit in
 *      `RCHG_PENDING` against a recharge that can never be resolved again. The refund
 *      amount is therefore DISPLAYED AND NOT TYPED — it is the whole line total including
 *      surcharge.
 *   3. `REFUND_MODE_NOT_AVAILABLE`. Which modes exist is a fact about the original
 *      payment, not a choice (`RechargeFailureResolutionService.java:317-332`), and this
 *      screen holds that payment's own tender rows — so it offers the same list the server
 *      would, from the same inputs. See `residualModes` for the one case where it cannot.
 *
 * ⚠ A double-click is NOT an error to retry. #12 takes no `Idempotency-Key` because §7.2
 * guards it with V29's unique retry key instead, so the loser of the race gets a 409
 * `DUPLICATE_RETRY` — which means "someone already did this", and this screen answers it
 * by offering a re-read rather than another attempt.
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
  /** The payment read failed, so the tender rows this screen reasons from are missing. */
  paymentUnread = false;

  // -- the resolution panels -----------------------------------------------

  panel: Panel = 'none';

  /** The FACE VALUE of the new attempt. The original's surcharge carries over untouched. */
  retryAmount: number | null = null;
  retryDifferenceMode: ResidualMode | null = null;
  retryTopUpMethod: SettlementMethod | null = null;
  retryNote = '';

  refundMode: ResidualMode | null = null;
  refundNote = '';

  /** The customer a `KEEP_AS_ADVANCE` or a credit top-up names. */
  chosenCustomer: CreditCustomerResponse | null = null;
  customerQuery = '';
  customerResults: CreditCustomerResponse[] = [];
  customerSearching = false;

  submitting = false;
  submitError = '';
  /**
   * Someone else has already resolved this. Separate from `submitError` because the
   * answer is to re-read, not to try again, and the screen must not offer the button back.
   */
  alreadyDone = false;

  /**
   * The modes a 422 said ARE available, which then replace the derived list.
   *
   * Only ever set from `details.available`. It exists for the case the derivation cannot
   * cover — see `residualModes`.
   */
  private serverModes: ResidualMode[] | null = null;

  retried: RetryRechargeResponse | null = null;
  refunded: RefundResponse | null = null;

  private readonly customerProbe = new Subject<string>();
  private readonly subscriptions = new Subscription();

  constructor(private route: ActivatedRoute, private api: RechargeApiService) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.route.paramMap
        .pipe(
          switchMap((params) => {
            const raw = params.get('failedId');
            this.rechargeId = raw && /^\d+$/.test(raw) ? Number(raw) : null;
            return this.findFailure();
          })
        )
        .subscribe((page) => this.applyFailure(page?.content ?? null))
    );

    this.subscriptions.add(
      this.customerProbe
        .pipe(
          debounceTime(250),
          distinctUntilChanged(),
          switchMap((value) => {
            this.customerSearching = true;
            return this.api.searchCustomers(value).pipe(catchError(() => of([])));
          })
        )
        .subscribe((rows) => {
          this.customerSearching = false;
          this.customerResults = rows;
        })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  /** Re-read after a 409, or after the staff member asks. */
  refresh(): void {
    this.alreadyDone = false;
    this.submitError = '';
    this.subscriptions.add(
      this.findFailure().subscribe((page) => this.applyFailure(page?.content ?? null))
    );
  }

  private findFailure() {
    this.loading = true;
    this.loadError = '';
    this.notAFailure = false;
    this.failure = null;
    this.payment = null;
    this.paymentUnread = false;
    // ⚠ Dropped on a re-read. It narrows the modes from one refusal about one payment, so
    // carrying it across a reload would hide a mode that is genuinely available.
    this.serverModes = null;
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
  }

  private applyFailure(rows: RechargeWorkItemResponse[] | null): void {
    this.loading = false;
    if (this.rechargeId === null) {
      this.notAFailure = true;
      return;
    }
    if (!rows) {
      // Either a load error already set, or a bad id.
      this.notAFailure = !this.loadError;
      return;
    }
    const found = rows.find((row) => row.rechargeId === this.rechargeId);
    if (!found) {
      this.notAFailure = true;
      return;
    }
    this.failure = found;
    this.loadPayment(found.paymentId);
  }

  /** How the customer paid — which is also what decides the modes money can go back by. */
  private loadPayment(paymentId: number): void {
    this.subscriptions.add(
      this.api
        .transaction(paymentId)
        .pipe(
          catchError(() => {
            this.paymentUnread = true;
            return of(null);
          })
        )
        .subscribe((transaction) => (this.payment = transaction))
    );
  }

  // -- what is being held ---------------------------------------------------

  /**
   * What is being held against this failure.
   *
   * The recharge's own amount plus its surcharge — not the whole payment, which may have
   * covered a second recharge that went through perfectly well. It is also exactly the
   * refund amount, which is why that figure is never typed.
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
    return this.methodWordFor(line.method);
  }

  methodWordFor(method: SettlementMethod): string {
    switch (method) {
      case 'CASH':
        return 'in cash';
      case 'UPI':
        return 'by UPI';
      case 'CREDIT':
        return 'on credit';
    }
  }

  // -- which ways money may go back -----------------------------------------

  private get cashLine(): SettlementLineResponse | undefined {
    return this.paidBy.find((line) => line.method === 'CASH');
  }

  private get creditLine(): SettlementLineResponse | undefined {
    return this.paidBy.find((line) => line.method === 'CREDIT');
  }

  /**
   * The modes money may leave `RCHG_PENDING` by, for this sale.
   *
   * ⚠ DERIVED FROM THE ORIGINAL PAYMENT, exactly as the server derives it
   * (`RechargeFailureResolutionService.java:317-332`): cash only where cash was
   * collected, credit reduction only where that payment carried a credit line, and
   * keeping it on account always. This is not a guess — the screen is reading the same
   * tender rows from the same payment.
   *
   * ⚠ It is a guess in ONE case: the payment read failed, so there are no tender rows
   * here to reason from. Then the list is whatever a 422 last told us, and otherwise just
   * `KEEP_AS_ADVANCE` — the one mode available on every payment — with the screen saying
   * why the other two are not offered. Offering all three and letting the staff member
   * discover the refusal would be the version that guesses.
   */
  get residualModes(): ResidualMode[] {
    if (this.serverModes) {
      return this.serverModes;
    }
    if (!this.payment) {
      return ['KEEP_AS_ADVANCE'];
    }
    const modes: ResidualMode[] = [];
    if (this.cashLine) {
      modes.push('CASH');
    }
    modes.push('KEEP_AS_ADVANCE');
    if (this.creditLine) {
      modes.push('CREDIT_REDUCTION');
    }
    return modes;
  }

  /** The only tender that paid was UPI, so there is no cash to hand back. */
  get noCashToReturn(): boolean {
    return !!this.payment && !this.cashLine;
  }

  modeLabel(mode: ResidualMode): string {
    switch (mode) {
      case 'CASH':
        return 'Cash back';
      case 'KEEP_AS_ADVANCE':
        return 'Keep it on their account';
      case 'CREDIT_REDUCTION':
        return 'Take it off what they owe';
    }
  }

  /**
   * The sentence under each mode.
   *
   * `CREDIT_REDUCTION` names the customer rather than offering a choice, because the
   * server reduces THAT line's customer and ignores a `customerId` in the request
   * (`RechargeFailureResolutionService.java:349-357`) — letting a request name a
   * different one would move a debt between two people's accounts.
   */
  modeNote(mode: ResidualMode): string {
    switch (mode) {
      case 'CASH':
        return 'Out of the drawer, now.';
      case 'KEEP_AS_ADVANCE':
        return 'Held against their name to spend next time.';
      case 'CREDIT_REDUCTION': {
        const name = this.creditLine?.customerName;
        return name
          ? `Off ${name}'s tab — the customer this payment was charged to.`
          : 'Off the tab this payment was charged to.';
      }
    }
  }

  /**
   * Whether this mode needs a customer named in the request.
   *
   * ⚠ `CREDIT_REDUCTION` does NOT, even though it lands on a customer: the server picks
   * the one on the original credit line and ignores whatever is sent.
   */
  needsCustomer(mode: ResidualMode | null): boolean {
    return mode === 'KEEP_AS_ADVANCE';
  }

  // -- the retry panel ------------------------------------------------------

  /** The face value that failed. The surcharge is not in here and never changes. */
  get originalAmount(): number {
    return this.failure?.amount ?? 0;
  }

  get carriedSurcharge(): number {
    return this.failure?.surcharge ?? 0;
  }

  /**
   * Which way the difference falls, in paise so two JSON floats cannot disagree.
   *
   * This is the ONE decision that picks the settlement field, and sending the wrong field
   * is a 422 — so it is computed from the typed amount rather than chosen by the staff
   * member.
   */
  get retryDirection(): Direction {
    const typed = Math.round((this.retryAmount ?? this.originalAmount) * 100);
    const original = Math.round(this.originalAmount * 100);
    if (typed === original) {
      return 'same';
    }
    return typed < original ? 'lower' : 'higher';
  }

  /** The gap, always positive. Its direction is `retryDirection`. */
  get retryDifference(): number {
    const typed = Math.round((this.retryAmount ?? this.originalAmount) * 100);
    const original = Math.round(this.originalAmount * 100);
    return Math.abs(typed - original) / 100;
  }

  /** What the customer ends up having paid for the new attempt, surcharge included. */
  get retryTotal(): number {
    const typed = Math.round((this.retryAmount ?? this.originalAmount) * 100);
    return (typed + Math.round(this.carriedSurcharge * 100)) / 100;
  }

  get topUpMethods(): SettlementMethod[] {
    // Money coming IN, so every method is open — unlike the way back out.
    return ['CASH', 'UPI', 'CREDIT'];
  }

  /**
   * Whether the retry can be sent.
   *
   * The settlement question has to be answered in the direction the amount implies, and
   * must be left unanswered when the amount did not move.
   */
  get retryReady(): boolean {
    const amount = this.retryAmount;
    if (amount === null || !(amount >= 1)) {
      return false;
    }
    switch (this.retryDirection) {
      case 'same':
        return true;
      case 'lower':
        return (
          !!this.retryDifferenceMode
          && (!this.needsCustomer(this.retryDifferenceMode) || !!this.chosenCustomer)
        );
      case 'higher':
        return (
          !!this.retryTopUpMethod
          && (this.retryTopUpMethod !== 'CREDIT' || !!this.chosenCustomer)
        );
    }
  }

  get refundReady(): boolean {
    return !!this.refundMode && (!this.needsCustomer(this.refundMode) || !!this.chosenCustomer);
  }

  // -- opening and closing the panels ---------------------------------------

  openRetry(): void {
    this.panel = 'retry';
    this.retryAmount = this.originalAmount;
    this.resetPanelState();
  }

  openRefund(): void {
    this.panel = 'refund';
    // Pre-picked when there is only one way money can go back, which is the common case.
    this.refundMode = this.residualModes.length === 1 ? this.residualModes[0] : null;
    this.resetPanelState();
  }

  cancelPanel(): void {
    this.panel = 'none';
    this.resetPanelState();
  }

  private resetPanelState(): void {
    this.retryDifferenceMode = null;
    this.retryTopUpMethod = null;
    this.retryNote = '';
    this.refundNote = '';
    this.chosenCustomer = null;
    this.customerQuery = '';
    this.customerResults = [];
    this.submitError = '';
    this.alreadyDone = false;
  }

  /**
   * ⚠ Clears the customer when the new choice does not need one.
   *
   * Left behind, it would be sent with a `CASH` difference, and the server would take it
   * as naming an account — the staff member believing cash went over the counter while
   * the money sat on someone's name.
   */
  chooseDifferenceMode(mode: ResidualMode): void {
    this.retryDifferenceMode = mode;
    if (!this.needsCustomer(mode)) {
      this.clearCustomer();
    }
  }

  chooseRefundMode(mode: ResidualMode): void {
    this.refundMode = mode;
    if (!this.needsCustomer(mode)) {
      this.clearCustomer();
    }
  }

  chooseTopUpMethod(method: SettlementMethod): void {
    this.retryTopUpMethod = method;
    if (method !== 'CREDIT') {
      this.clearCustomer();
    }
  }

  // -- naming a customer ----------------------------------------------------

  onCustomerQuery(value: string): void {
    this.customerQuery = value;
    if (value.trim().length >= 2) {
      this.customerProbe.next(value.trim());
    } else {
      this.customerResults = [];
    }
  }

  chooseCustomer(customer: CreditCustomerResponse): void {
    this.chosenCustomer = customer;
    this.customerResults = [];
    this.customerQuery = '';
  }

  clearCustomer(): void {
    this.chosenCustomer = null;
    this.customerQuery = '';
    this.customerResults = [];
  }

  // -- sending --------------------------------------------------------------

  submitRetry(): void {
    if (this.rechargeId === null || !this.retryReady || this.submitting) {
      return;
    }
    const request: RetryRechargeRequest = { amount: this.retryAmount as number };
    const note = this.retryNote.trim() || null;

    // ⚠ Exactly one of the two, decided by the direction, and NEITHER when the amount did
    // not move. An extra one is refused rather than ignored (§3.2 #12).
    if (this.retryDirection === 'lower') {
      request.differenceSettlement = {
        mode: this.retryDifferenceMode as ResidualMode,
        customerId: this.needsCustomer(this.retryDifferenceMode)
          ? (this.chosenCustomer?.customerId ?? null)
          : null,
        note
      };
    } else if (this.retryDirection === 'higher') {
      request.topUp = {
        method: this.retryTopUpMethod as SettlementMethod,
        customerId: this.retryTopUpMethod === 'CREDIT'
          ? (this.chosenCustomer?.customerId ?? null)
          : null,
        note
      };
    }

    this.submitting = true;
    this.submitError = '';
    this.subscriptions.add(
      this.api.retry(this.rechargeId, request).subscribe({
        next: (response) => {
          this.submitting = false;
          this.retried = response;
          this.panel = 'none';
        },
        error: (error) => this.handleSubmitError(error)
      })
    );
  }

  submitRefund(): void {
    if (this.rechargeId === null || !this.refundReady || this.submitting) {
      return;
    }
    const request: RefundRechargeRequest = {
      // ⚠ The WHOLE line total, surcharge included. Not typed, so it cannot be partial.
      amount: this.held,
      mode: this.refundMode as ResidualMode,
      customerId: this.needsCustomer(this.refundMode)
        ? (this.chosenCustomer?.customerId ?? null)
        : null,
      note: this.refundNote.trim() || null
    };

    this.submitting = true;
    this.submitError = '';
    this.subscriptions.add(
      this.api.refund(this.rechargeId, request).subscribe({
        next: (response) => {
          this.submitting = false;
          this.refunded = response;
          this.panel = 'none';
        },
        error: (error) => this.handleSubmitError(error)
      })
    );
  }

  /**
   * ⚠ "Already resolved" is not an error state.
   *
   * A 409 `DUPLICATE_RETRY` means this request lost a race that V29's unique key decided
   * in the database — so the retry it would repeat has HAPPENED. Showing it as a failure
   * invites a second attempt at work that is already done. The panel closes and the screen
   * offers a re-read instead.
   *
   * A `REFUND_MODE_NOT_AVAILABLE` narrows the choices to the list the server sent rather
   * than leaving the staff member to find the other refusals one at a time.
   */
  private handleSubmitError(error: unknown): void {
    this.submitting = false;
    const available = availableRefundModes(error);
    if (available) {
      this.serverModes = available;
      if (this.refundMode && !available.includes(this.refundMode)) {
        this.refundMode = null;
      }
      if (this.retryDifferenceMode && !available.includes(this.retryDifferenceMode)) {
        this.retryDifferenceMode = null;
      }
    }
    if (isAlreadyResolved(error)) {
      this.alreadyDone = true;
      this.panel = 'none';
      return;
    }
    this.submitError = errorSentence(error);
  }

  // -- what came back -------------------------------------------------------

  get settled(): boolean {
    return !!this.retried || !!this.refunded;
  }

  /**
   * Whose account the money landed on, ready to put in front of a noun.
   *
   * ⚠ Possessive when there is a name. Without it the real screen read "₹199.00 taken off
   * Ravi More tab", which is how the sentence comes out of a template that treats a name
   * and the word "their" as interchangeable. They are not.
   */
  private whose(name: string | null | undefined): string {
    return name ? `${name}'s` : 'their';
  }

  /** The one sentence saying what happened to the money, read off the response. */
  get outcomeSentence(): string {
    if (this.refunded) {
      const whose = this.whose(this.refunded.credit?.customerName);
      switch (this.refunded.mode) {
        case 'CASH':
          return `₹${this.refunded.amount.toFixed(2)} handed back in cash.`;
        case 'KEEP_AS_ADVANCE':
          return `₹${this.refunded.amount.toFixed(2)} kept on ${whose} account.`;
        case 'CREDIT_REDUCTION':
          return `₹${this.refunded.amount.toFixed(2)} taken off ${whose} tab.`;
      }
    }
    if (this.retried) {
      const { differenceOwed, differenceSettledAs, topUpTaken, topUpTakenAs } = this.retried;
      if (differenceOwed && differenceSettledAs) {
        const whose = this.whose(this.retried.credit?.customerName);
        switch (differenceSettledAs) {
          case 'CASH':
            return `₹${differenceOwed.toFixed(2)} difference handed back in cash.`;
          case 'KEEP_AS_ADVANCE':
            return `₹${differenceOwed.toFixed(2)} difference kept on ${whose} account.`;
          case 'CREDIT_REDUCTION':
            return `₹${differenceOwed.toFixed(2)} difference taken off ${whose} tab.`;
        }
      }
      if (topUpTaken && topUpTakenAs) {
        return `₹${topUpTaken.toFixed(2)} more taken ${this.methodWordFor(topUpTakenAs)}, `
          + 'added to the original payment.';
      }
      return 'Same amount, so nothing changed hands.';
    }
    return '';
  }
}
