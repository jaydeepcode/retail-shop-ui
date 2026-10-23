import { Observable, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import {
  CreateCustomerRequest,
  CreateCustomerRequestResult,
  CreditCustomerResponse,
  SettlementLineRequest,
  SettlementMethod
} from './payment.models';

/**
 * One row of the payment panel. Normally there is exactly one, and it is cash.
 *
 * ⚠ `amount` and `amountTendered` are typed `number | string` because that is the truth:
 * they are bound with `[(ngModel)]` to text inputs, which write back STRINGS. Typing them
 * as `number` was a lie that cost a real defect — the counter sent `"100"` and `"199"`,
 * the screen's own "left to allocate" read ₹0.00 because JavaScript coerces for `*`, and
 * the server then refused the basket with `providedTotal: 100199` from string
 * concatenation. Every read of these goes through `num()`.
 */
export interface PaymentLine {
  method: SettlementMethod;
  amount: number | string | null;
  /** CASH only — `SettlementMethod.carriesTender()`. */
  amountTendered?: number | string | null;
  /** UPI only. */
  reference?: string;
  /** CREDIT only, and required for it. */
  customer?: CreditCustomerResponse;
  note?: string;
}

/**
 * A figure typed into a text input, as a number.
 *
 * Blank, whitespace and anything unparseable are 0 — the panel refuses to settle until
 * the rows sum, so 0 is the safe reading of "nothing typed yet" rather than a guess.
 */
export function num(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return 0;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

/** What the payment lines currently account for. */
export function allocated(lines: PaymentLine[]): number {
  const paise = lines.reduce((sum, line) => sum + Math.round(num(line.amount) * 100), 0);
  return paise / 100;
}

/**
 * The settlement lines.
 *
 * `amountTendered` goes only on cash, because that is the only method that has a tender
 * and change. A short payment is expressed as a smaller cash line plus a credit line —
 * the server never silently invents credit, it only verifies that the lines sum.
 */
export function toSettlementLines(lines: PaymentLine[]): SettlementLineRequest[] {
  return lines.map((line) => {
    // ⚠ Coerced, never passed through: these come from text inputs as strings, and the
    // contract says `amount` is a number.
    const request: SettlementLineRequest = {
      method: line.method,
      amount: num(line.amount)
    };
    if (line.method === 'CASH' && line.amountTendered != null && line.amountTendered !== '') {
      request.amountTendered = num(line.amountTendered);
    }
    if (line.method === 'UPI' && line.reference) {
      request.reference = line.reference;
    }
    if (line.method === 'CREDIT') {
      if (line.customer) {
        request.customerId = line.customer.customerId;
      }
      if (line.note) {
        request.note = line.note;
      }
    }
    return request;
  });
}

/**
 * The slice of the customer book a tender needs, which `RechargeApiService` already
 * satisfies structurally.
 *
 * ⚠ A port rather than the service itself, so `shared/` does not import `features/
 * recharge/`. Endpoints #4 and #5 are mounted under `/recharge` on the server today but
 * are not recharge's — a ticket sold on credit names a customer from the same book.
 */
export interface CustomerDirectory {
  searchCustomers(query: string, limit?: number): Observable<CreditCustomerResponse[]>;
  createCustomer(request: CreateCustomerRequest): Observable<CreditCustomerResponse>;
}

/** What the host screen tells a tender about the sale it is settling. */
export interface TenderOptions {
  directory: CustomerDirectory;
  /**
   * The figure the lines must add up to.
   *
   * ⚠ A supplier, not a number, and deliberately: the total is the host's — a basket of
   * recharges, or a ticket's `fareAmount + commissionAmount` — and it changes while the
   * panel is on screen. Reading it through a function means the panel is never one
   * change-detection pass behind the screen it is drawn on.
   */
  totalToMatch: () => number;
  /**
   * §14.5's threshold, from `config.changeDisplayThreshold`. A supplier for the same
   * reason: config arrives after the screen is built.
   */
  changeThreshold: () => number;
  /** Called whenever the staff change the tender, so the host can drop a stale error. */
  onEdit?: () => void;
  /** How a `createCustomer` failure becomes a sentence. The host owns error wording. */
  errorSentence: (error: unknown) => string;
  /** A 409 carrying the customer who already holds that mobile, or null. */
  asExistingCustomer: (error: unknown) => CreateCustomerRequestResult | null;
}

/**
 * How a customer paid — the rules, with no Angular in them.
 *
 * Extracted from `counter.component.ts`, where this was fifteen members inline, because
 * the ticket screen settles the same way and `design-ticket-booking.md` §4 assumed a
 * component that no slice had built (`next-session-s4.md` correction 1). The counter now
 * holds one of these and delegates to it; `PaymentPanelComponent` draws it.
 *
 * ⚠ A plain class and not the component's state, so a host can read `leftToAllocate` the
 * instant a figure is typed rather than after the next change-detection pass — which is
 * what `counter.component.spec.ts` asserts, and what a `@ViewChild` could not give it
 * once the panel is hidden by the waiting state.
 *
 * It owns the tender half only. The basket is the host's: what is being sold, what it
 * comes to, and what is sent alongside these lines.
 */
export class Tender {
  lines: PaymentLine[] = [freshCash()];

  /** The panel's own message — the 5-line cap. A server refusal is the host's. */
  error = '';

  customerQuery = '';
  customerResults: CreditCustomerResponse[] = [];
  customerSearching = false;

  // -- adding a customer who is not in the book yet ------------------------
  addingCustomer = false;
  newCustomer: CreateCustomerRequest = { firstName: '', lastName: '', mobile: '' };
  creatingCustomer = false;
  createCustomerError = '';
  /** A 409 names whoever already holds that mobile, so they can be used instead. */
  existingCustomer: CreateCustomerRequestResult | null = null;

  private readonly customerProbe = new Subject<string>();
  private readonly subscriptions = new Subscription();

  constructor(private readonly options: TenderOptions) {
    this.subscriptions.add(
      this.customerProbe
        .pipe(
          debounceTime(250),
          distinctUntilChanged(),
          switchMap((value) => {
            this.customerSearching = true;
            return this.options.directory.searchCustomers(value).pipe(catchError(() => of([])));
          })
        )
        .subscribe((rows) => {
          this.customerSearching = false;
          this.customerResults = rows;
        })
    );
  }

  destroy(): void {
    this.subscriptions.unsubscribe();
  }

  /** What the lines have to add up to. */
  get total(): number {
    return this.options.totalToMatch();
  }

  // =========================================================================
  // The methods
  // =========================================================================

  isMethodOn(method: SettlementMethod): boolean {
    return this.lines.some((line) => line.method === method);
  }

  /**
   * One method is on by default and each further tap adds a row: splitting is 0.42% of
   * baskets ever and none at all in FY2026-27 (§14.7), so it is opt-in rather than drawn.
   */
  toggleMethod(method: SettlementMethod): void {
    this.error = '';
    this.options.onEdit?.();
    const at = this.lines.findIndex((line) => line.method === method);
    if (at >= 0) {
      // The last row cannot be dropped — a payment needs at least one line.
      if (this.lines.length > 1) {
        this.lines.splice(at, 1);
      }
      return;
    }
    if (this.lines.length >= 5) {
      this.error = 'A payment takes at most 5 lines.';
      return;
    }
    this.lines.push(
      method === 'CASH' ? freshCash() : { method, amount: null }
    );
  }

  line(method: SettlementMethod): PaymentLine | undefined {
    return this.lines.find((l) => l.method === method);
  }

  /** The single-method case: the one line covers the whole total, so it is not typed. */
  get isSingleMethod(): boolean {
    return this.lines.length === 1;
  }

  // =========================================================================
  // Cash, the tender and the change
  // =========================================================================

  /** What this row settles in cash: the typed share, or the whole total on its own. */
  cashLineOf(row: PaymentLine): number {
    return this.isSingleMethod ? this.total : num(row.amount);
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
    const threshold = Math.round(this.options.changeThreshold() * 100);
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
    return this.isSingleMethod ? this.total : allocated(this.lines);
  }

  get leftToAllocate(): number {
    return Math.round((this.total - this.allocatedTotal) * 100) / 100;
  }

  // =========================================================================
  // Credit — who is taking it, and what they will owe
  // =========================================================================

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

  /** What this sale will put on the tab: the credit line's share of the total. */
  get creditAmount(): number {
    const credit = this.line('CREDIT');
    if (!credit) {
      return 0;
    }
    return this.isSingleMethod ? this.total : num(credit.amount);
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

    this.options.directory.createCustomer(request).subscribe({
      next: (created) => {
        this.creatingCustomer = false;
        this.chooseCustomer(created);
      },
      error: (error) => {
        this.creatingCustomer = false;
        // ⚠ A duplicate mobile answers 409 carrying `CreateCustomerRequestResult` — the
        // existing customer, not an error body. Offering them beats making the staff
        // search again for someone the server has already found.
        const duplicate = this.options.asExistingCustomer(error);
        if (duplicate) {
          this.existingCustomer = duplicate;
          return;
        }
        this.createCustomerError = this.options.errorSentence(error);
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
    this.options.directory.searchCustomers(existing.contactNumber, 5).subscribe({
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
        this.createCustomerError = this.options.errorSentence(error);
      }
    });
  }

  // =========================================================================
  // Settling
  // =========================================================================

  /**
   * Whether the tender itself is settleable. The host adds its own conditions — the
   * counter will not settle an empty basket, and neither will the ticket screen settle
   * a booking that is not filled in.
   */
  get isReady(): boolean {
    const credit = this.line('CREDIT');
    if (credit && !credit.customer) {
      return false;
    }
    // A tender below its own cash line is INVALID_TENDER server-side, so it is caught
    // here rather than after the refusal.
    if (this.lines.some((line) => this.tenderIsShort(line))) {
      return false;
    }
    // The lines have to add up before the button works, which is how a short payment
    // becomes credit rather than a silent write-off.
    return this.isSingleMethod ? true : Math.abs(this.leftToAllocate) < 0.005;
  }

  /**
   * The lines as the server wants them.
   *
   * On a single method the one line carries the whole total, so the amount is filled in
   * rather than typed. Cash with no tender typed means exact money.
   */
  settlementLines(): SettlementLineRequest[] {
    const resolved: PaymentLine[] = this.lines.map((line) => ({
      ...line,
      amount: this.isSingleMethod ? this.total : num(line.amount),
      amountTendered:
        line.method === 'CASH'
          ? line.amountTendered != null && line.amountTendered !== ''
            ? num(line.amountTendered)
            // Nothing typed means they gave the exact money.
            : this.isSingleMethod ? this.total : num(line.amount)
          : undefined
    }));
    return toSettlementLines(resolved);
  }

  /** Back to one cash line, for the next sale. */
  reset(): void {
    this.lines = [freshCash()];
    this.error = '';
    this.customerQuery = '';
    this.customerResults = [];
    this.customerSearching = false;
    this.cancelAddingCustomer();
  }
}

function freshCash(): PaymentLine {
  return { method: 'CASH', amount: null, amountTendered: null };
}
