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
import { newIdempotencyKey } from '../../shared/idempotency-key';
import { RechargeApiService } from '../services/recharge-api.service';
import {
  asExistingCustomer,
  errorSentence,
  firstBadRechargeIndex,
  isRouteFixable
} from '../services/recharge-error';
import { basketTotal, BasketLine, toRechargeLines } from './basket';
import { PaymentLine, Tender } from '../../shared/payment/tender';

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
  /** The failure is one a different route would fix, so the picker is called out. */
  answerNeedsRoute = false;
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
  private readonly subscriptions = new Subscription();

  /**
   * How the customer paid — the three buttons, the split rows, the credit panel and
   * every rule about them (`shared/payment/tender.ts`).
   *
   * ⚠ `totalToMatch` is a function rather than a figure: the basket changes while the
   * panel is on screen, and a copied number would be a second opinion about the total.
   * `onEdit` is what used to be `toggleMethod`'s first line — changing the tender drops
   * a settle error that no longer describes it.
   */
  readonly tender: Tender;

  constructor(private api: RechargeApiService) {
    this.tender = new Tender({
      directory: api,
      totalToMatch: () => this.provisionalTotal,
      changeThreshold: () => this.config?.changeDisplayThreshold ?? 0,
      onEdit: () => (this.settleError = ''),
      errorSentence,
      asExistingCustomer
    });
  }

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

  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.tender.destroy();
    this.clearCopyState();
  }

  private clearCopyState(): void {
    this.copied = false;
    this.copyFailed = false;
    if (this.copyResetTimer) {
      clearTimeout(this.copyResetTimer);
      this.copyResetTimer = null;
    }
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

  /**
   * A search that came back with nothing.
   *
   * ⚠ The screen must NOT claim to know why. `/recharge/tv-connections` reads
   * `rc_dishtv_dtls`, which holds boxes recharged before — 458 of them on the restore and
   * none at all on a fresh database — and there is no count endpoint, so "nothing matches"
   * and "nothing is on file" are indistinguishable from here. Saying "no connection
   * matches that" asserts the first and reads as a broken search when it is the second.
   * So it says what is true of both and points at the way through.
   */
  get connectionSearchFoundNothing(): boolean {
    return (
      this.connectionQuery.trim().length >= 2 &&
      !this.connectionSearching &&
      !this.connectionResults.length &&
      !this.chosenConnection
    );
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
  // Payment — delegated to `tender`
  // =========================================================================

  /**
   * ⚠ Everything down to `canTakePayment` is delegation, and deliberately so.
   *
   * The rules and the state live in `Tender` (`shared/payment/tender.ts`) because the
   * ticket screen settles the same way; what is left here is the counter's own surface,
   * kept because `counter.component.spec.ts` is the guard on this extraction and reaches
   * through it 110 times. A pass-through that keeps 935 lines of assertions honest is
   * worth more than the lines it costs.
   *
   * `takePayment` is NOT delegation: what settling means is the counter's — a basket of
   * recharges, one idempotency key per basket, and a screen that then holds the sale.
   */

  get payment(): PaymentLine[] {
    return this.tender.lines;
  }

  get customerQuery(): string {
    return this.tender.customerQuery;
  }

  set customerQuery(value: string) {
    this.tender.customerQuery = value;
  }

  get customerResults(): CreditCustomerResponse[] {
    return this.tender.customerResults;
  }

  get customerSearching(): boolean {
    return this.tender.customerSearching;
  }

  isMethodOn(method: SettlementMethod): boolean {
    return this.tender.isMethodOn(method);
  }

  toggleMethod(method: SettlementMethod): void {
    this.tender.toggleMethod(method);
  }

  line(method: SettlementMethod): PaymentLine | undefined {
    return this.tender.line(method);
  }

  get isSingleMethod(): boolean {
    return this.tender.isSingleMethod;
  }

  cashLineOf(row: PaymentLine): number {
    return this.tender.cashLineOf(row);
  }

  provisionalChange(row: PaymentLine): number | null {
    return this.tender.provisionalChange(row);
  }

  tenderIsShort(row: PaymentLine): boolean {
    return this.tender.tenderIsShort(row);
  }

  get allocatedTotal(): number {
    return this.tender.allocatedTotal;
  }

  get leftToAllocate(): number {
    return this.tender.leftToAllocate;
  }

  onCustomerQuery(value: string): void {
    this.tender.onCustomerQuery(value);
  }

  chooseCustomer(customer: CreditCustomerResponse): void {
    this.tender.chooseCustomer(customer);
  }

  clearCustomer(): void {
    this.tender.clearCustomer();
  }

  get creditAmount(): number {
    return this.tender.creditAmount;
  }

  get willOweAfterThis(): number | null {
    return this.tender.willOweAfterThis;
  }

  get advanceLeftAfterThis(): number {
    return this.tender.advanceLeftAfterThis;
  }

  // -- adding a customer who is not in the book yet ------------------------

  get addingCustomer(): boolean {
    return this.tender.addingCustomer;
  }

  get newCustomer(): CreateCustomerRequest {
    return this.tender.newCustomer;
  }

  set newCustomer(value: CreateCustomerRequest) {
    this.tender.newCustomer = value;
  }

  get creatingCustomer(): boolean {
    return this.tender.creatingCustomer;
  }

  get createCustomerError(): string {
    return this.tender.createCustomerError;
  }

  get existingCustomer(): CreateCustomerRequestResult | null {
    return this.tender.existingCustomer;
  }

  startAddingCustomer(): void {
    this.tender.startAddingCustomer();
  }

  cancelAddingCustomer(): void {
    this.tender.cancelAddingCustomer();
  }

  get canCreateCustomer(): boolean {
    return this.tender.canCreateCustomer;
  }

  createCustomer(): void {
    this.tender.createCustomer();
  }

  useExistingCustomer(): void {
    this.tender.useExistingCustomer();
  }

  // -- settling, which is the counter's own --------------------------------

  get canTakePayment(): boolean {
    if (!this.basket.length || this.settling) {
      return false;
    }
    return this.tender.isReady;
  }

  takePayment(): void {
    if (!this.canTakePayment) {
      return;
    }
    this.settling = true;
    this.settleError = '';
    this.badLineIndex = null;

    this.api
      .settle(
        {
          recharges: toRechargeLines(this.basket),
          settlementLines: this.tender.settlementLines()
        },
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
    this.answerNeedsRoute = false;
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
          this.answerNeedsRoute = isRouteFixable(error);
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
    this.answerNeedsRoute = false;
    this.clearCopyState();

    // One at a time: three recharges mean three calls and three outcomes. There is
    // deliberately no complete-all, because recharge 3 failing would roll back 1 and 2.
    if (this.held && this.answeringIndex + 1 < this.held.recharges.length) {
      this.answeringIndex += 1;
      return;
    }
    this.startFresh();
  }

  /**
   * Copying the number, because retyping it is where a wrong recharge comes from.
   *
   * ⚠ `navigator.clipboard` is undefined outside a secure context, and this app is quite
   * likely to be opened from another machine on the shop LAN over plain HTTP rather than
   * on localhost. So there is a fallback rather than a button that silently does nothing
   * on the one machine that matters.
   */
  copied = false;
  copyFailed = false;
  private copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  async copyNumber(): Promise<void> {
    const current = this.current;
    if (!current) {
      return;
    }
    // Always the plain digits: never what is on screen, which carries the 4-3-3 gaps.
    const ok = await this.writeToClipboard(current.number);
    this.copied = ok;
    this.copyFailed = !ok;
    if (this.copyResetTimer) {
      clearTimeout(this.copyResetTimer);
    }
    this.copyResetTimer = setTimeout(() => {
      this.copied = false;
      this.copyFailed = false;
      this.copyResetTimer = null;
    }, 2500);
  }

  private async writeToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall through to the older path rather than giving up.
    }
    try {
      const scratch = document.createElement('textarea');
      scratch.value = text;
      scratch.setAttribute('readonly', '');
      scratch.style.position = 'fixed';
      scratch.style.opacity = '0';
      document.body.appendChild(scratch);
      scratch.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(scratch);
      return ok;
    } catch {
      return false;
    }
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
    this.tender.reset();
    this.idempotencyKey = newIdempotencyKey();
    this.numberText = '';
    this.amountText = '';
    this.entryError = '';
    this.settleError = '';
    this.answerError = '';
    this.clearHint();
    this.clearConnection();
    this.clearCopyState();
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
