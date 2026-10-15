import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import {
  CounterConfigResponse,
  CreateCustomerRequest,
  CreateCustomerRequestResult,
  CreditCustomerResponse,
  MarkCompleteRequest,
  MarkFailedRequest,
  OperatorConfig,
  RechargeResponse,
  ServiceType,
  SettlementMethod,
  TransactionResponse,
  TvConnectionResponse
} from '../model/recharge.models';
import { newIdempotencyKey } from '../services/idempotency-key';
import { RechargeApiService } from '../services/recharge-api.service';
import { asExistingCustomer, errorSentence, firstBadRechargeIndex } from '../services/recharge-error';
import {
  allocated,
  basketTotal,
  BasketLine,
  num,
  PaymentLine,
  toRechargeLines,
  toSettlementLines
} from './basket';

/** Artboard 1 and 3 are this in `entry`; artboard 2 is this in `waiting`. */
type CounterState = 'entry' | 'waiting';

/** How a TV connection got into the basket. */
type TvMode = 'search' | 'manual';

/**
 * The counter — artboards 1, 2 and 3, which are one screen in two states.
 *
 * Entry and payment share a screen because 94% of sales never need a second one, and the
 * screen does NOT clear when payment is taken: the job is not finished until the recharge
 * has been done in the operator's app. Artboard 2's note is explicit that this is a state
 * and not a dialog — "you have to leave this app to do the recharge. A dialog would sit on
 * top of everything while you were away, and you would come back unsure whether it was
 * still live." §8.1:550 rejected a modal once already, for the same reason.
 *
 * Keyboard first, because the whole point of the counter is that it never needs a mouse:
 * F1/F2 pick the service, Enter adds to the basket, F12 takes payment, F8/F9 answer
 * "did it go through?", Esc sets a sale aside. Alt+1..5 belong to the section bar.
 */
@Component({
  selector: 'app-counter',
  templateUrl: './counter.component.html',
  styleUrl: './counter.component.scss'
})
export class CounterComponent implements OnInit, OnDestroy {
  config: CounterConfigResponse | null = null;
  configError = '';

  state: CounterState = 'entry';

  // -- the entry form ------------------------------------------------------
  serviceType: ServiceType = 'MOBILE';
  numberText = '';
  operatorCode = '';
  amountText = '';
  surchargeText = '';
  /** Until the staff touch it, the server's configured default is authoritative. */
  private surchargeTouched = false;

  /** The seen-before hint. `known: false` is ordinary — `rc_recharge` is empty until V15. */
  hintChecked = false;
  hintKnown = false;
  hintSummary = '';

  // -- TV entry ------------------------------------------------------------
  tvMode: TvMode = 'search';
  connectionQuery = '';
  connectionResults: TvConnectionResponse[] = [];
  connectionSearching = false;
  chosenConnection: TvConnectionResponse | null = null;

  // -- the basket ----------------------------------------------------------
  basket: BasketLine[] = [];
  entryError = '';
  /** Set from `fieldErrors`' index paths, so the cursor lands on the line the server named. */
  badLineIndex: number | null = null;

  // -- the payment panel ---------------------------------------------------
  payment: PaymentLine[] = [{ method: 'CASH', amount: null, amountTendered: null }];
  customerQuery = '';
  customerResults: CreditCustomerResponse[] = [];
  customerSearching = false;

  settling = false;
  settleError = '';

  // -- the waiting state ---------------------------------------------------
  /** The settled payment this screen is holding until every recharge is answered. */
  held: TransactionResponse | null = null;
  /** Which of `held.recharges` is being answered. One at a time, never in bulk (§4.4). */
  answeringIndex = 0;
  vendorRef = '';
  routeOverride = '';
  answering = false;
  answerError = '';
  /** What has already been answered, so the screen can show progress on a 2-line basket. */
  answered: RechargeResponse[] = [];

  @ViewChild('numberField') numberField?: ElementRef<HTMLInputElement>;
  @ViewChild('amountField') amountField?: ElementRef<HTMLInputElement>;
  @ViewChild('connectionField') connectionField?: ElementRef<HTMLInputElement>;

  /**
   * One key per basket, kept across retries and replaced only when the basket changes.
   * Sending the same key twice returns the original transaction rather than charging
   * twice, which is what makes a retry after a timeout safe.
   */
  private idempotencyKey = newIdempotencyKey();

  private readonly numberProbe = new Subject<string>();
  private readonly connectionProbe = new Subject<string>();
  private readonly customerProbe = new Subject<string>();
  private readonly subscriptions = new Subscription();

  constructor(private api: RechargeApiService) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.api.config().subscribe({
        next: (config) => {
          this.config = config;
          this.pickDefaultOperator();
          this.resetSurchargeToDefault();
        },
        error: (error) => (this.configError = errorSentence(error))
      })
    );

    // The hint is worth asking for: 88.5% of mobile numbers and 93.6% of TV go to one
    // seen before, and the operator differs on only 8.8% of mobile repeats (§14.10).
    this.subscriptions.add(
      this.numberProbe
        .pipe(
          debounceTime(250),
          distinctUntilChanged(),
          switchMap((value) =>
            this.api.numberHint('MOBILE', value).pipe(catchError(() => of(null)))
          )
        )
        .subscribe((hint) => {
          this.hintChecked = true;
          this.hintKnown = hint?.known ?? false;
          if (hint?.known) {
            this.applyHint(hint.operatorCode, hint.lastAmount, hint.lastRechargeAt);
          } else {
            this.hintSummary = '';
          }
        })
    );

    this.subscriptions.add(
      this.connectionProbe
        .pipe(
          debounceTime(250),
          distinctUntilChanged(),
          switchMap((value) => {
            this.connectionSearching = true;
            return this.api.tvConnections(value).pipe(catchError(() => of([])));
          })
        )
        .subscribe((rows) => {
          this.connectionSearching = false;
          this.connectionResults = rows;
        })
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

  // =========================================================================
  // The keyboard map
  // =========================================================================

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    // Alt belongs to the section bar's Alt+1..5; modified function keys are the browser's.
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (this.state === 'entry') {
      switch (event.key) {
        case 'F1':
          event.preventDefault();
          this.chooseService('MOBILE');
          return;
        case 'F2':
          event.preventDefault();
          this.chooseService('TV');
          return;
        case 'F12':
          event.preventDefault();
          this.takePayment();
          return;
        default:
          return;
      }
    }

    switch (event.key) {
      case 'F8':
        event.preventDefault();
        this.markDone();
        return;
      case 'F9':
        event.preventDefault();
        this.markFailed();
        return;
      case 'Escape':
        event.preventDefault();
        this.setAside();
        return;
      default:
        return;
    }
  }

  // =========================================================================
  // Entry
  // =========================================================================

  chooseService(serviceType: ServiceType): void {
    if (this.serviceType === serviceType) {
      return;
    }
    this.serviceType = serviceType;
    this.numberText = '';
    this.amountText = '';
    this.entryError = '';
    this.clearHint();
    this.clearConnection();
    this.tvMode = 'search';
    this.pickDefaultOperator();
    this.resetSurchargeToDefault();
    setTimeout(() => this.focusFirstField());
  }

  get operators(): OperatorConfig[] {
    return (this.config?.operators ?? []).filter((o) => o.serviceType === this.serviceType);
  }

  get chosenOperator(): OperatorConfig | null {
    return this.operators.find((o) => o.code === this.operatorCode) ?? null;
  }

  /**
   * ⚠ May legitimately be empty, and empty is an answer rather than a loading state.
   * TV operators have no presets at all and Vi has none either (open item 1), so an
   * empty list renders a bare amount field — never a spinner waiting for rows.
   */
  get presets(): number[] {
    return this.chosenOperator?.presets ?? [];
  }

  /** TV amounts are a multiple of 10 except ₹216 and three ₹1 rows, so ±₹10 is the control. */
  get usesStepper(): boolean {
    return this.serviceType === 'TV';
  }

  onNumberInput(value: string): void {
    this.numberText = value;
    this.entryError = '';
    const digits = value.replace(/\D/g, '');
    this.clearHint();
    if (digits.length === 10) {
      this.numberProbe.next(digits);
    }
  }

  /**
   * No operator is selected until one is picked or the number hint supplies it. Nothing
   * in the data justifies defaulting to one, and silently pre-selecting the busiest would
   * send a recharge to the wrong operator on the staff's first keystroke.
   */
  chooseOperator(code: string): void {
    this.operatorCode = code;
    this.entryError = '';
    // The presets belong to the operator, so the chips change under the amount. An amount
    // already typed is deliberately left alone — the staff may have meant it.
  }

  choosePreset(amount: number): void {
    this.amountText = String(amount);
    this.entryError = '';
  }

  stepAmount(by: number): void {
    const current = Number(this.amountText) || 0;
    this.amountText = String(Math.max(0, current + by));
    this.entryError = '';
  }

  onSurchargeInput(value: string): void {
    this.surchargeText = value;
    this.surchargeTouched = true;
  }

  // -- TV connection search ------------------------------------------------

  onConnectionInput(value: string): void {
    this.connectionQuery = value;
    this.chosenConnection = null;
    // The server refuses a query under 2 characters, so it is not asked.
    if (value.trim().length >= 2) {
      this.connectionProbe.next(value.trim());
    } else {
      this.connectionResults = [];
    }
  }

  chooseConnection(connection: TvConnectionResponse): void {
    this.chosenConnection = connection;
    this.connectionResults = [];
    this.connectionQuery = connection.name;
    this.numberText = connection.connectionNumber;
    // The connection knows its own operator, so the chips are not needed here.
    this.operatorCode = connection.operatorCode;
    this.resetSurchargeToDefault();
    setTimeout(() => this.amountField?.nativeElement.focus());
  }

  /**
   * ⚠ A box that is not in `rc_dishtv_dtls` has no path through artboard 3, which enters
   * TV by searching that table's 458 rows. Reported rather than invented: this is the
   * fallback, and it asks for the two things the search would have supplied.
   */
  enterConnectionByHand(): void {
    this.tvMode = 'manual';
    this.chosenConnection = null;
    this.connectionResults = [];
    this.numberText = '';
    this.pickDefaultOperator();
    setTimeout(() => this.numberField?.nativeElement.focus());
  }

  backToConnectionSearch(): void {
    this.tvMode = 'search';
    this.clearConnection();
    setTimeout(() => this.connectionField?.nativeElement.focus());
  }

  // -- adding to the basket ------------------------------------------------

  get canAddToBasket(): boolean {
    return !!this.numberText.replace(/\D/g, '') && !!this.operatorCode && Number(this.amountText) > 0;
  }

  addToBasket(): void {
    this.entryError = '';
    const digits = this.numberText.replace(/\D/g, '');

    // Shape only. The authoritative checks are the server's, because they depend on data
    // the browser does not have — that the operator is live, that a rate exists.
    if (this.serviceType === 'MOBILE' && !/^[0-9]{10}$/.test(digits)) {
      this.entryError = 'A mobile number is 10 digits.';
      this.numberField?.nativeElement.focus();
      return;
    }
    if (this.serviceType === 'TV' && !/^[0-9]{6,12}$/.test(digits)) {
      this.entryError = 'A TV connection number is 6 to 12 digits.';
      this.numberField?.nativeElement.focus();
      return;
    }
    const operator = this.chosenOperator;
    if (!operator) {
      this.entryError = 'Pick an operator.';
      return;
    }
    const amount = Number(this.amountText);
    if (!(amount >= 1)) {
      this.entryError = 'A recharge is at least ₹1.';
      this.amountField?.nativeElement.focus();
      return;
    }
    if (this.basket.length >= 20) {
      this.entryError = 'A basket takes at most 20 recharges.';
      return;
    }

    this.basket.push({
      serviceType: this.serviceType,
      number: digits,
      operatorCode: operator.code,
      operatorName: operator.name,
      amount,
      surcharge: this.surchargeToSend(),
      connectionName: this.chosenConnection?.name,
      defaultRouteName: this.routeNameOf(operator.defaultRouteCode)
    });

    // The basket changed, so the key must change with it.
    this.idempotencyKey = newIdempotencyKey();
    this.badLineIndex = null;
    this.settleError = '';

    this.numberText = '';
    this.amountText = '';
    this.clearHint();
    this.clearConnection();
    this.resetSurchargeToDefault();
    setTimeout(() => this.focusFirstField());
  }

  removeLine(index: number): void {
    this.basket.splice(index, 1);
    this.idempotencyKey = newIdempotencyKey();
    this.badLineIndex = null;
    this.settleError = '';
  }

  /**
   * What the basket comes to, for display before it is settled. After settling, the
   * screen reads `held.totalDue` instead — the server recomputes it so the client cannot
   * disagree, and this figure is gone the moment there is a real one.
   */
  get provisionalTotal(): number {
    return basketTotal(this.basket, (line) => this.defaultSurchargeFor(line.serviceType));
  }

  // =========================================================================
  // Payment
  // =========================================================================

  isMethodOn(method: SettlementMethod): boolean {
    return this.payment.some((line) => line.method === method);
  }

  /**
   * One method is on by default and each further tap adds a row: splitting is 0.42% of
   * baskets ever and none at all in FY2026-27 (§14.7), so it is opt-in rather than drawn.
   */
  toggleMethod(method: SettlementMethod): void {
    this.settleError = '';
    const at = this.payment.findIndex((line) => line.method === method);
    if (at >= 0) {
      // The last row cannot be dropped — a payment needs at least one line.
      if (this.payment.length > 1) {
        this.payment.splice(at, 1);
      }
      return;
    }
    if (this.payment.length >= 5) {
      this.settleError = 'A payment takes at most 5 lines.';
      return;
    }
    this.payment.push(
      method === 'CASH' ? { method, amount: null, amountTendered: null } : { method, amount: null }
    );
  }

  line(method: SettlementMethod): PaymentLine | undefined {
    return this.payment.find((l) => l.method === method);
  }

  /** The single-method case: the one line covers the whole basket, so it is not typed. */
  get isSingleMethod(): boolean {
    return this.payment.length === 1;
  }

  /** What this row settles in cash: the typed share, or the whole basket on its own. */
  cashLineOf(row: PaymentLine): number {
    return this.isSingleMethod ? this.provisionalTotal : num(row.amount);
  }

  /**
   * What goes back to the customer, shown on the row before the sale commits.
   *
   * Artboard 3 draws this as "back ₹200", and it is what makes the two cash boxes
   * readable — the share of the bill, what was handed over, and the difference.
   *
   * ⚠ §14.5's threshold still applies: a rupee is not change, nobody hands it over, and
   * showing it the same way as ₹201 is what made it noise. The threshold is read from
   * `config.changeDisplayThreshold` rather than hard-coded, which is why config carries
   * it. After the sale the screen reads the server's `changeDisplayed` instead and never
   * this — the authoritative flag is the server's, so two clients cannot disagree.
   */
  provisionalChange(row: PaymentLine): number | null {
    if (row.method !== 'CASH' || row.amountTendered == null || row.amountTendered === '') {
      return null;
    }
    const paise = Math.round(num(row.amountTendered) * 100) - Math.round(this.cashLineOf(row) * 100);
    if (paise <= 0) {
      return null;
    }
    const threshold = Math.round((this.config?.changeDisplayThreshold ?? 0) * 100);
    return paise >= threshold ? paise / 100 : null;
  }

  /**
   * Whether less cash was taken than the cash line claims.
   *
   * The server refuses this with `INVALID_TENDER`; saying so on the row means the staff
   * fix it before pressing F12 rather than after being refused.
   */
  tenderIsShort(row: PaymentLine): boolean {
    if (row.method !== 'CASH' || row.amountTendered == null || row.amountTendered === '') {
      return false;
    }
    return Math.round(num(row.amountTendered) * 100) < Math.round(this.cashLineOf(row) * 100);
  }

  get allocatedTotal(): number {
    return this.isSingleMethod ? this.provisionalTotal : allocated(this.payment);
  }

  get leftToAllocate(): number {
    return Math.round((this.provisionalTotal - this.allocatedTotal) * 100) / 100;
  }

  onCustomerQuery(value: string): void {
    this.customerQuery = value;
    if (value.trim().length >= 2) {
      this.customerProbe.next(value.trim());
    } else {
      this.customerResults = [];
    }
  }

  chooseCustomer(customer: CreditCustomerResponse): void {
    const credit = this.line('CREDIT');
    if (credit) {
      credit.customer = customer;
    }
    this.customerResults = [];
    this.customerQuery = '';
    this.cancelAddingCustomer();
  }

  clearCustomer(): void {
    const credit = this.line('CREDIT');
    if (credit) {
      credit.customer = undefined;
    }
  }

  /** What this sale will put on the tab: the credit line's share of the basket. */
  get creditAmount(): number {
    const credit = this.line('CREDIT');
    if (!credit) {
      return 0;
    }
    return this.isSingleMethod ? this.provisionalTotal : num(credit.amount);
  }

  /**
   * Artboard 3's third figure — what they will owe once this sale commits.
   *
   * Provisional, exactly like the basket total: before the settle call there is no server
   * figure to disagree with, and the response's `outstandingAfter` replaces it the moment
   * there is one. It follows §14.8's mirror rule — a charge consumes any advance first and
   * only then becomes debt — so it agrees with what the server is about to do rather than
   * inventing a second opinion.
   *
   * This is the figure that makes the warning actionable: "already owes ₹340" does not
   * tell the staff whether to extend more, and "will owe ₹389" does.
   */
  get willOweAfterThis(): number | null {
    const customer = this.line('CREDIT')?.customer;
    if (!customer) {
      return null;
    }
    const paise =
      Math.round(customer.outstanding * 100) +
      Math.round(this.creditAmount * 100) -
      Math.round(customer.advanceHeld * 100);
    return Math.max(0, paise) / 100;
  }

  /** What is left of their advance once this sale has eaten into it. */
  get advanceLeftAfterThis(): number {
    const customer = this.line('CREDIT')?.customer;
    if (!customer) {
      return 0;
    }
    const paise = Math.round(customer.advanceHeld * 100) - Math.round(this.creditAmount * 100);
    return Math.max(0, paise) / 100;
  }

  // -- adding a customer who is not in the book yet ------------------------

  addingCustomer = false;
  newCustomer: CreateCustomerRequest = { firstName: '', lastName: '', mobile: '' };
  creatingCustomer = false;
  createCustomerError = '';
  /** A 409 names whoever already holds that mobile, so they can be used instead. */
  existingCustomer: CreateCustomerRequestResult | null = null;

  /**
   * A walk-in taking credit has to be named, and 506 customers is not everyone. Endpoint
   * #5 exists for exactly this, and without a caller a new customer could only be added
   * by someone editing the database.
   */
  startAddingCustomer(): void {
    this.addingCustomer = true;
    this.createCustomerError = '';
    this.existingCustomer = null;
    // The search box usually already holds what was typed; a 10-digit string is a mobile.
    const typed = this.customerQuery.trim();
    this.newCustomer = /^[0-9]{10}$/.test(typed.replace(/\s/g, ''))
      ? { firstName: '', lastName: '', mobile: typed.replace(/\s/g, '') }
      : { firstName: typed, lastName: '', mobile: '' };
  }

  cancelAddingCustomer(): void {
    this.addingCustomer = false;
    this.creatingCustomer = false;
    this.createCustomerError = '';
    this.existingCustomer = null;
    this.newCustomer = { firstName: '', lastName: '', mobile: '' };
  }

  get canCreateCustomer(): boolean {
    return (
      !this.creatingCustomer &&
      !!this.newCustomer.firstName.trim() &&
      /^[0-9]{10}$/.test(this.newCustomer.mobile.trim())
    );
  }

  createCustomer(): void {
    if (!this.canCreateCustomer) {
      return;
    }
    this.creatingCustomer = true;
    this.createCustomerError = '';
    this.existingCustomer = null;

    const request: CreateCustomerRequest = {
      firstName: this.newCustomer.firstName.trim(),
      mobile: this.newCustomer.mobile.trim()
    };
    // Not @NotBlank on the server: 147 of 506 rows have no last name, and a walk-in may
    // give only one name.
    const lastName = (this.newCustomer.lastName ?? '').trim();
    if (lastName) {
      request.lastName = lastName;
    }

    this.api.createCustomer(request).subscribe({
      next: (created) => {
        this.creatingCustomer = false;
        this.chooseCustomer(created);
      },
      error: (error) => {
        this.creatingCustomer = false;
        // ⚠ A duplicate mobile answers 409 carrying `CreateCustomerRequestResult` — the
        // existing customer, not an error body. Offering them beats making the staff
        // search again for someone the server has already found.
        const duplicate = asExistingCustomer(error);
        if (duplicate) {
          this.existingCustomer = duplicate;
          return;
        }
        this.createCustomerError = errorSentence(error);
      }
    });
  }

  /**
   * Use the customer the 409 named. Their figures are not in that body, so they are read
   * back by search rather than assumed to be zero — a duplicate is often someone who
   * already owes.
   */
  useExistingCustomer(): void {
    const existing = this.existingCustomer;
    if (!existing) {
      return;
    }
    this.creatingCustomer = true;
    this.api.searchCustomers(existing.contactNumber, 5).subscribe({
      next: (rows) => {
        this.creatingCustomer = false;
        const match = rows.find((row) => row.customerId === existing.existingCustomerId);
        if (match) {
          this.chooseCustomer(match);
          return;
        }
        this.createCustomerError = 'That customer could not be read back. Search for them by name.';
      },
      error: (error) => {
        this.creatingCustomer = false;
        this.createCustomerError = errorSentence(error);
      }
    });
  }

  get canTakePayment(): boolean {
    if (!this.basket.length || this.settling) {
      return false;
    }
    const credit = this.line('CREDIT');
    if (credit && !credit.customer) {
      return false;
    }
    // A tender below its own cash line is INVALID_TENDER server-side, so it is caught
    // here rather than after the refusal.
    if (this.payment.some((line) => this.tenderIsShort(line))) {
      return false;
    }
    // The lines have to add up before the button works, which is how a short payment
    // becomes credit rather than a silent write-off.
    return this.isSingleMethod ? true : Math.abs(this.leftToAllocate) < 0.005;
  }

  takePayment(): void {
    if (!this.canTakePayment) {
      return;
    }
    this.settling = true;
    this.settleError = '';
    this.badLineIndex = null;

    // On a single method the one line carries the whole basket, so the amount is filled
    // in rather than typed. Cash with no tender typed means exact money.
    const lines: PaymentLine[] = this.payment.map((line) => ({
      ...line,
      amount: this.isSingleMethod ? this.provisionalTotal : num(line.amount),
      amountTendered:
        line.method === 'CASH'
          ? line.amountTendered != null && line.amountTendered !== ''
            ? num(line.amountTendered)
            // Nothing typed means they gave the exact money.
            : this.isSingleMethod ? this.provisionalTotal : num(line.amount)
          : undefined
    }));

    this.api
      .settle(
        { recharges: toRechargeLines(this.basket), settlementLines: toSettlementLines(lines) },
        this.idempotencyKey
      )
      .subscribe({
        next: (transaction) => {
          this.settling = false;
          this.enterWaiting(transaction);
        },
        error: (error) => {
          this.settling = false;
          this.settleError = errorSentence(error);
          // `fieldErrors` carries index paths like `recharges[1].amount`, which is what
          // lets the cursor land on the line the server objected to.
          this.badLineIndex = firstBadRechargeIndex(error);
        }
      });
  }

  // =========================================================================
  // Waiting — artboard 2
  // =========================================================================

  private enterWaiting(transaction: TransactionResponse): void {
    this.held = transaction;
    this.answered = [];
    this.answeringIndex = 0;
    this.vendorRef = '';
    this.routeOverride = '';
    this.answerError = '';
    this.state = 'waiting';
  }

  /** The recharge being answered. */
  get current(): RechargeResponse | null {
    return this.held?.recharges[this.answeringIndex] ?? null;
  }

  /**
   * The cash line's change, but only when the server says to show it.
   *
   * ⚠ Never re-derived from `changeDue` and the threshold. §14.5 keeps change under ₹5
   * off the screen — a rupee is not handed over, the customer waves it away — and the
   * rule lives server-side so two clients cannot disagree about it.
   */
  get changeToShow(): number | null {
    const cash = this.held?.settlementLines.find((l) => l.method === 'CASH');
    return cash?.changeDisplayed ? cash.changeGiven ?? null : null;
  }

  get cashTaken(): number | null {
    return this.held?.settlementLines.find((l) => l.method === 'CASH')?.amountTendered ?? null;
  }

  /** The route the success button names, and the one the override offers instead. */
  get otherRoutes(): { code: string; name: string }[] {
    const current = this.current;
    if (!current || !this.config) {
      return [];
    }
    return this.config.routes.filter((route) => route.code !== current.routeCode);
  }

  markDone(): void {
    const current = this.current;
    if (!current || this.answering) {
      return;
    }
    this.answering = true;
    this.answerError = '';
    const request: MarkCompleteRequest = {};
    if (this.vendorRef.trim()) {
      request.vendorRef = this.vendorRef.trim();
    }
    // The route rides on "yes": it is the first moment anyone knows which connection was
    // used, and an override is 2 recharges in six months, so it is one small line.
    if (this.routeOverride) {
      request.routeCode = this.routeOverride;
    }
    this.api
      .complete(current.rechargeId, request)
      .subscribe({
        next: (answered) => this.afterAnswer(answered),
        error: (error) => {
          this.answering = false;
          this.answerError = errorSentence(error);
        }
      });
  }

  markFailed(reason?: string): void {
    const current = this.current;
    if (!current || this.answering) {
      return;
    }
    this.answering = true;
    this.answerError = '';
    // A failed recharge consumes no float (§7.2:370), so no route is attributed here.
    const request: MarkFailedRequest = {};
    if (reason?.trim()) {
      request.reason = reason.trim();
    }
    this.api.fail(current.rechargeId, request).subscribe({
      next: (answered) => this.afterAnswer(answered),
      error: (error) => {
        this.answering = false;
        this.answerError = errorSentence(error);
      }
    });
  }

  private afterAnswer(answered: RechargeResponse): void {
    this.answering = false;
    this.answered.push(answered);
    this.vendorRef = '';
    this.routeOverride = '';

    // One at a time: three recharges mean three calls and three outcomes. There is
    // deliberately no complete-all, because recharge 3 failing would roll back 1 and 2.
    if (this.held && this.answeringIndex + 1 < this.held.recharges.length) {
      this.answeringIndex += 1;
      return;
    }
    this.startFresh();
  }

  /** Esc — someone else is waiting. What is left moves to the worklist untouched. */
  setAside(): void {
    this.startFresh();
  }

  get setAsideCount(): number {
    const total = this.held?.recharges.length ?? 0;
    return total - this.answered.length;
  }

  private startFresh(): void {
    this.state = 'entry';
    this.held = null;
    this.answered = [];
    this.answeringIndex = 0;
    this.basket = [];
    this.payment = [{ method: 'CASH', amount: null, amountTendered: null }];
    this.idempotencyKey = newIdempotencyKey();
    this.numberText = '';
    this.amountText = '';
    this.entryError = '';
    this.settleError = '';
    this.answerError = '';
    this.clearHint();
    this.clearConnection();
    this.tvMode = 'search';
    this.resetSurchargeToDefault();
    setTimeout(() => this.focusFirstField());
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private focusFirstField(): void {
    if (this.serviceType === 'TV' && this.tvMode === 'search') {
      this.connectionField?.nativeElement.focus();
      return;
    }
    this.numberField?.nativeElement.focus();
  }

  private pickDefaultOperator(): void {
    const operators = this.operators;
    this.operatorCode = operators.length === 1 ? operators[0].code : '';
  }

  /**
   * Whether the counter offers our charge for what is being sold.
   *
   * ⚠ TV only (owner, 2026-10-15: "only applicable for TV, not for Mobile").
   * Driven by the server's configured default rather than by a hardcoded `=== 'TV'`,
   * so the day `surcharge.default.mobile` is set to something non-zero in
   * `rc_setting`, the field appears without a release — which is what
   * requirement 10's config-in-tables is for.
   */
  get chargeApplies(): boolean {
    return this.defaultSurchargeFor(this.serviceType) > 0;
  }

  private defaultSurchargeFor(serviceType: ServiceType): number {
    if (!this.config) {
      return 0;
    }
    // DTH by default, mobile off — §15.11 item 3 narrows §10.2 deliberately. The 198
    // historical mobile cases stay as history and are not a defect.
    return serviceType === 'TV' ? this.config.surchargeDefaultTv : this.config.surchargeDefaultMobile;
  }

  private resetSurchargeToDefault(): void {
    this.surchargeTouched = false;
    const value = this.defaultSurchargeFor(this.serviceType);
    this.surchargeText = value ? String(value) : '';
  }

  /**
   * ⚠ The tri-state, resolved at the one place it matters.
   *
   * Untouched: omitted, so the server applies its own default and stays authoritative.
   * Touched: sent explicitly, including `0`, so a cleared DTH charge survives the round
   * trip. The client never sends `0` to mean "unset" — that is the distinction
   * next-session-s3-screens.md calls out.
   */
  private surchargeToSend(): number | undefined {
    // ⚠ Mobile never sends one from this screen. The server would accept it —
    // §15.11 keeps it representable and V28's CHECK is >= 0 rather than keyed to
    // the service type — but the counter does not offer it, so sending a value
    // the staff member was never shown would be inventing money.
    if (!this.chargeApplies || !this.surchargeTouched) {
      return undefined;
    }
    const text = this.surchargeText.trim();
    if (text === '') {
      return 0;
    }
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  /** A route's human name. Lookup codes like `SRVTEB` are never shown (§6.1). */
  routeNameOf(code: string): string {
    return this.config?.routes.find((route) => route.code === code)?.name ?? code;
  }


  private applyHint(
    operatorCode: string | null,
    lastAmount: number | null,
    lastRechargeAt: string | null
  ): void {
    if (operatorCode && this.operators.some((o) => o.code === operatorCode)) {
      this.operatorCode = operatorCode;
    }
    if (lastAmount != null && !this.amountText) {
      this.amountText = String(lastAmount);
    }
    const operatorName = this.operators.find((o) => o.code === operatorCode)?.name ?? operatorCode;
    const when = lastRechargeAt ? new Date(lastRechargeAt) : null;
    const whenText = when
      ? when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      : '';
    this.hintSummary = `Last recharge ${operatorName} · ₹${lastAmount} ${whenText ? 'on ' + whenText : ''}`.trim();
  }

  private clearHint(): void {
    this.hintChecked = false;
    this.hintKnown = false;
    this.hintSummary = '';
  }

  private clearConnection(): void {
    this.chosenConnection = null;
    this.connectionResults = [];
    this.connectionQuery = '';
    this.connectionSearching = false;
  }

  /** Stable identity for the basket strip, so removing a line does not re-create the rest. */
  lineKey(index: number, line: BasketLine): string {
    return `${index}:${line.number}:${line.operatorCode}:${line.amount}`;
  }
}
