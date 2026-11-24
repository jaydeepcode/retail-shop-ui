import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { errorSentence } from '../../recharge/services/recharge-error';
import { newIdempotencyKey } from '../../shared/idempotency-key';
import { AccountResponse, VoucherResponse } from '../model/accounts.models';
import { AccountsApiService, asReplayedVoucher } from '../services/accounts-api.service';

/** The two tills that share the recharge drawer — see `contraAccounts` and `paidFromAccounts`. */
export const CASH_RECHARGE = 'CASH_RECHARGE';
export const CASH_TICKET = 'CASH_TICKET';
/** The water drawer — kept out of the top-up's payer picker, not out of the contra's. */
export const CASH_WATER = 'CASH_WATER';
/** Paying from here is what makes a top-up a cash one — no IMPS fee arises. */
export const CASH_SAFE = 'CASH_SAFE';

/**
 * `/accounts/transfers` — endpoint 8 (artboard 13, whole) and endpoint 19's capture form
 * only (artboard 12's right-hand "Recording the top-up" panel).
 *
 * ## Artboard 12's left half is out of scope, and so is nothing it depends on
 *
 * The four wallets checked against the portal balance — "agrees" / "Out by" / "Sort it
 * out" — is endpoint 4, `RATE_CORRECTION`, a separate session's work. This screen asks
 * `GET /accounts` for the float accounts by `floatPattern`, same as every other picker
 * here, and shows no portal figure, no "agrees" state and no correction reason, because
 * none of those come from endpoint 19.
 *
 * ## Both account pickers come from endpoint 12, never a hardcoded list
 *
 * The server additionally checks `IS_ACTIVE` on every write, so this screen's lists are
 * labels only (§1.3).
 *
 * - **The contra's two pickers** offer six of the eight accounts #8 legally accepts —
 *   `ASSET`, `REPORT_GROUP = 'CASH_AND_BANK'`, `ALLOW_MANUAL = TRUE` — dropping
 *   `CASH_RECHARGE` and `CASH_TICKET`: a hand-typed contra against a till almost always
 *   duplicates the nightly automatic sweep. The endpoint still accepts them; this screen
 *   just does not offer them.
 * - **The top-up's float picker** is the four `FLOAT_*` accounts, filtered on
 *   `floatPattern` being non-null — that is what MAKES an account a float, never a code
 *   prefix.
 * - **The top-up's "paid from" picker** is the same `ASSET`/`CASH_AND_BANK`/`ALLOW_MANUAL`
 *   accounts as the contra's, with all three tills dropped rather than two: a bank or the
 *   safe is what pays for a top-up in practice, and `CASH_WATER` has no reason to be there.
 *
 * ## A contra never touches profit or loss
 *
 * `AFFECTS_PL = FALSE` on `CONTRA` is what makes it FRD §8.2's "pure asset relocation", so
 * the recorded panel states "reaching profit or loss: ₹0.00" explicitly rather than
 * leaving it implied.
 *
 * ## The ₹5 fee is its own leg, read from `GET /config`, and zero on a cash top-up
 *
 * `transferFee` defaults to `rc_setting['float.imps.fee']` (`GET /config`'s
 * `floatImpsFee`) and is never a literal (§14.5, item 3). Paying from `CASH_SAFE` sends
 * `transferFee: 0` rather than omitting the field: no IMPS fee arises on a cash top-up, and
 * a zero leg is illegal (`ck_line_nonzero`), so the server reads the explicit `0` as
 * "leave the fee leg off" rather than "post it at ₹0.00" (`PurchaseRequest.java`).
 *
 * ## Both writes take a client-generated `Idempotency-Key`, one per voucher
 *
 * Unlike the close screen's two writes, only the client can tell a retry from a second
 * real transfer or top-up (§1.3). Each form keeps its key across a plain failure — a
 * genuine retry has to look identical, or the key buys nothing — and mints a fresh one
 * only once an attempt has actually landed, a `201` or the `409` a replay returns.
 *
 * ## A 409 carries the voucher, and is shown as the answer, not an error
 *
 * `VoucherController.created`'s own javadoc: a user-initiated write answers `409` with the
 * voucher that already exists, so a double-click gets the figures rather than a bare
 * refusal.
 */
@Component({
  selector: 'app-transfers',
  templateUrl: './transfers.component.html',
  styleUrl: './transfers.component.scss'
})
export class TransfersComponent implements OnInit, OnDestroy {
  accounts: AccountResponse[] = [];
  loading = true;
  loadError = '';

  /**
   * `rc_setting['float.imps.fee']`, in rupees, or `null` when `GET /config` could not be
   * read. There is no fallback — see `close.component.ts`'s own copy of this reasoning.
   */
  floatImpsFee: number | null = null;

  // -- The transfer, endpoint 8 ---------------------------------------------

  contraFrom = '';
  contraTo = '';
  /** What the operator typed, in rupees. Text rather than a number so "5,000" reads back. */
  contraAmountInput = '';
  contraDateInput = todayIso();
  contraNarration = '';

  contraSubmitting = false;
  contraError = '';
  contraResult: VoucherResponse | null = null;
  private contraIdempotencyKey = newIdempotencyKey();

  // -- The top-up, endpoint 19 -----------------------------------------------

  topupFloatAccount = '';
  topupAmountInput = '';
  topupDateInput = todayIso();
  topupPaidFrom = '';

  topupSubmitting = false;
  topupError = '';
  topupResult: VoucherResponse | null = null;
  private topupIdempotencyKey = newIdempotencyKey();

  private readonly subscriptions = new Subscription();

  constructor(private api: AccountsApiService) {}

  ngOnInit(): void {
    this.load();
    this.loadConfig();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.subscriptions.add(
      this.api.accounts().subscribe({
        next: (accounts) => {
          this.loading = false;
          this.accounts = accounts;
          this.prefillDefaults();
        },
        error: (error) => {
          this.loading = false;
          this.loadError = errorSentence(error);
        }
      })
    );
  }

  /**
   * The fee, and nothing else from `/config`. A failure is not reported to the operator:
   * the top-up form disables its submit until a fee is known (see `canSubmitTopup`)
   * instead, which says the same thing without a second error strip on the screen.
   */
  private loadConfig(): void {
    this.subscriptions.add(
      this.api.config().subscribe({
        next: (config) => {
          const value = config?.floatImpsFee;
          this.floatImpsFee = typeof value === 'number' && value >= 0 ? value : null;
        },
        error: () => (this.floatImpsFee = null)
      })
    );
  }

  private prefillDefaults(): void {
    if (!this.contraFrom && this.contraAccounts.length) {
      this.contraFrom = this.contraAccounts[0].accountCode;
    }
    if (!this.contraTo) {
      this.contraTo = this.contraToOptions[0]?.accountCode ?? '';
    }
    if (!this.topupFloatAccount && this.floatAccounts.length) {
      this.topupFloatAccount = this.floatAccounts[0].accountCode;
    }
    if (!this.topupPaidFrom && this.paidFromAccounts.length) {
      this.topupPaidFrom = this.paidFromAccounts[0].accountCode;
    }
  }

  // -- The pickers, all from endpoint 12 -------------------------------------

  get contraAccounts(): AccountResponse[] {
    return this.accounts.filter(
      (a) =>
        a.reportGroup === 'CASH_AND_BANK'
        && a.allowManual
        && a.accountCode !== CASH_RECHARGE
        && a.accountCode !== CASH_TICKET
    );
  }

  /** Never the same account as `contraFrom` — the server refuses `Dr X / Cr X` outright. */
  get contraToOptions(): AccountResponse[] {
    return this.contraAccounts.filter((a) => a.accountCode !== this.contraFrom);
  }

  get floatAccounts(): AccountResponse[] {
    return this.accounts.filter((a) => !!a.floatPattern);
  }

  get paidFromAccounts(): AccountResponse[] {
    return this.accounts.filter(
      (a) =>
        a.reportGroup === 'CASH_AND_BANK'
        && a.allowManual
        && a.accountCode !== CASH_RECHARGE
        && a.accountCode !== CASH_TICKET
        && a.accountCode !== CASH_WATER
    );
  }

  accountName(code: string): string {
    return this.accounts.find((a) => a.accountCode === code)?.displayName ?? code;
  }

  trackByCode(_index: number, account: AccountResponse): string {
    return account.accountCode;
  }

  // -- The transfer's figures and validation ---------------------------------

  get contraAmount(): number | null {
    return parseRupees(this.contraAmountInput);
  }

  get contraAmountIsUnreadable(): boolean {
    return this.contraAmountInput.trim() !== '' && this.contraAmount === null;
  }

  get contraSameAccount(): boolean {
    return !!this.contraFrom && this.contraFrom === this.contraTo;
  }

  get contraDateInFuture(): boolean {
    return !!this.contraDateInput && this.contraDateInput > todayIso();
  }

  onContraFieldChanged(): void {
    this.contraError = '';
    this.contraResult = null;
  }

  /** Changing "out of" may orphan "into" on the same account — pick the next one instead. */
  onContraFromChanged(): void {
    if (this.contraSameAccount) {
      this.contraTo = this.contraToOptions[0]?.accountCode ?? '';
    }
    this.onContraFieldChanged();
  }

  get canSubmitContra(): boolean {
    return (
      !this.contraSubmitting
      && !!this.contraFrom
      && !!this.contraTo
      && !this.contraSameAccount
      && this.contraAmount !== null
      && this.contraAmount > 0
      && !!this.contraDateInput
      && !this.contraDateInFuture
    );
  }

  submitContra(): void {
    const amount = this.contraAmount;
    if (amount === null || !this.canSubmitContra) {
      return;
    }

    this.contraSubmitting = true;
    this.contraError = '';
    const narration = this.contraNarration.trim();
    this.subscriptions.add(
      this.api
        .postContra(
          {
            voucherDate: this.contraDateInput,
            fromAccountCode: this.contraFrom,
            toAccountCode: this.contraTo,
            amount,
            // @Size(max = 255) — a 400 for a long note would be this screen's fault.
            narration: narration ? narration.slice(0, 255) : undefined
          },
          this.contraIdempotencyKey
        )
        .subscribe({
          next: (response) => this.contraPosted(response),
          error: (error) => {
            this.contraSubmitting = false;
            const replayed = asReplayedVoucher(error);
            if (replayed) {
              // Not an error. The server answered 409 carrying the voucher that already
              // exists, so the operator gets the figures rather than a refusal.
              this.contraPosted(replayed);
              return;
            }
            this.contraError = errorSentence(error);
          }
        })
    );
  }

  private contraPosted(response: VoucherResponse): void {
    this.contraSubmitting = false;
    this.contraResult = response;
    this.contraAmountInput = '';
    this.contraNarration = '';
    // A new action next, whether this attempt just succeeded or had already succeeded
    // under this key — either way continuing to reuse it would carry the wrong identity
    // into whatever is typed next.
    this.contraIdempotencyKey = newIdempotencyKey();
  }

  get contraResultWasReplay(): boolean {
    return !!this.contraResult?.replayed;
  }

  // -- The top-up's figures and validation -----------------------------------

  get topupAmount(): number | null {
    return parseRupees(this.topupAmountInput);
  }

  get topupAmountIsUnreadable(): boolean {
    return this.topupAmountInput.trim() !== '' && this.topupAmount === null;
  }

  /** Paying from the safe is what makes this a cash top-up (E7, §1.3). */
  get topupIsCash(): boolean {
    return this.topupPaidFrom === CASH_SAFE;
  }

  /**
   * The fee this top-up will carry. `0` the moment the safe is the payer — no IMPS fee
   * arises on a cash top-up — otherwise `GET /config`'s own figure, with no fallback: a
   * guessed fee would quietly become the rule it was standing in for.
   */
  get topupFee(): number | null {
    return this.topupIsCash ? 0 : this.floatImpsFee;
  }

  get topupTotalOut(): number | null {
    const amount = this.topupAmount;
    const fee = this.topupFee;
    if (amount === null || fee === null) {
      return null;
    }
    return (paise(amount) + paise(fee)) / 100;
  }

  get topupDateInFuture(): boolean {
    return !!this.topupDateInput && this.topupDateInput > todayIso();
  }

  onTopupFieldChanged(): void {
    this.topupError = '';
    this.topupResult = null;
  }

  chooseTopupPaidFrom(code: string): void {
    this.topupPaidFrom = code;
    this.onTopupFieldChanged();
  }

  get canSubmitTopup(): boolean {
    return (
      !this.topupSubmitting
      && !!this.topupFloatAccount
      && !!this.topupPaidFrom
      && this.topupAmount !== null
      && this.topupAmount > 0
      && !!this.topupDateInput
      && !this.topupDateInFuture
      && this.topupFee !== null
    );
  }

  submitTopup(): void {
    const amount = this.topupAmount;
    const fee = this.topupFee;
    if (amount === null || fee === null || !this.canSubmitTopup) {
      return;
    }

    this.topupSubmitting = true;
    this.topupError = '';
    this.subscriptions.add(
      this.api
        .postPurchase(
          {
            voucherDate: this.topupDateInput,
            floatAccountCode: this.topupFloatAccount,
            amount,
            sourceAccountCode: this.topupPaidFrom,
            transferFee: fee
          },
          this.topupIdempotencyKey
        )
        .subscribe({
          next: (response) => this.topupPosted(response),
          error: (error) => {
            this.topupSubmitting = false;
            const replayed = asReplayedVoucher(error);
            if (replayed) {
              this.topupPosted(replayed);
              return;
            }
            this.topupError = errorSentence(error);
          }
        })
    );
  }

  private topupPosted(response: VoucherResponse): void {
    this.topupSubmitting = false;
    this.topupResult = response;
    this.topupAmountInput = '';
    this.topupIdempotencyKey = newIdempotencyKey();
  }

  get topupResultWasReplay(): boolean {
    return !!this.topupResult?.replayed;
  }
}

// -- Small helpers, kept local — see `close.component.ts`'s own copy for why --------------

function paise(rupeeValue: number): number {
  return Math.round(rupeeValue * 100);
}

/** `₹` and thousands separators are accepted because a prefilled field may carry them. */
export function parseRupees(input: string): number | null {
  const cleaned = (input ?? '').replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function isoOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function todayIso(): string {
  return isoOf(new Date());
}
