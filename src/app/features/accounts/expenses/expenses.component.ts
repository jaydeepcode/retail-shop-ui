import { Component, OnDestroy, OnInit } from '@angular/core';
import { forkJoin, Subscription } from 'rxjs';
import { errorSentence } from '../../recharge/services/recharge-error';
import { newIdempotencyKey } from '../../shared/idempotency-key';
import { AccountResponse, PaymentRequest, VoucherResponse } from '../model/accounts.models';
import { AccountsApiService, asReplayedVoucher } from '../services/accounts-api.service';

/**
 * Always what a typed category label posts against — `AccountDirectoryService`'s own
 * javadoc is explicit the chart of accounts gets no CRUD, ever (canvas note ex4).
 */
export const EXP_SUNDRY_SHOP = 'EXP_SUNDRY_SHOP';

/** The two source chips visible by default, before "Other source" is opened. */
export const CASH_SAFE = 'CASH_SAFE';
export const BANK_JANATA = 'BANK_JANATA';

/**
 * Never offered here, although endpoint 12 returns it. POOL-1's own primary
 * (`CASH_RECHARGE`) absorbs the pool's whole variance at close regardless of which member a
 * leg names, so crediting the recharge till for ticket-funded cash causes no bookkeeping
 * error — only a cosmetic skew in the close screen's informational split (canvas note ex3).
 */
export const CASH_TICKET = 'CASH_TICKET';

const CASH_RECHARGE = 'CASH_RECHARGE';
const CASH_WATER = 'CASH_WATER';

const CUSTOM_CATEGORIES_KEY = 'shop.expenses.customCategories';
const PROMOTED_SOURCES_KEY = 'shop.expenses.promotedSources';

/** One chip on the category row — a seeded account, or a label remembered client-side only. */
export interface CategoryChip {
  /** The seeded account code, or `custom:<label>` for a typed one — never reused as a posting code. */
  key: string;
  label: string;
  /** A short muted word naming the real account, shown only on a custom chip (`· Sundry`). */
  suffix: string | null;
  /** What this chip actually posts to — `EXP_SUNDRY_SHOP` for every custom chip, never a made-up code. */
  accountCode: string;
  isCustom: boolean;
}

/**
 * `/accounts/expenses` — artboard 14, whole: endpoint 7 of `design-ledger-api.md` §1.3.
 *
 * ## "+ New category" adds a label, not a ledger account
 *
 * `AccountDirectoryService`'s own javadoc is explicit the chart of accounts gets no CRUD,
 * ever — "a screen for it would invite accounts that no posting rule knows about." So a
 * typed category always sends `expenseAccountCode: EXP_SUNDRY_SHOP`, and the typed label is
 * carried only in `narration` (see {@link narrationToSend}), never joining `acc_account`.
 * The label is remembered in `localStorage`, scoped to this browser, and shown as an extra
 * chip next time with a muted `· Sundry` suffix so the chip stays honest about what it
 * posts to even while it reads "Pump repair" (canvas note ex4).
 *
 * ## Both chip rows come from endpoint 12, never a hardcoded list
 *
 * The five seeded categories and the eight manual asset accounts are both read from
 * `GET /accounts`, with the server doing the filtering (`?manualOnly=true&type=…`) rather
 * than this screen fetching everything and filtering client-side, the way the transfers tab
 * does — the five category codes are exactly the `FUNDING_ACCOUNTS`-style duplication
 * `next-session-s5.md` warns against, so they are never written down here.
 *
 * ## The source row collapses to two chips, and "Other source" discloses the rest
 *
 * `CASH_SAFE` and `BANK_JANATA` are always visible. Everything else endpoint 12 returns for
 * `type=ASSET` — the two remaining tills and the three family banks — sits behind a dashed
 * "Other source" chip, **except `CASH_TICKET`, which this screen never offers at all**
 * (canvas note ex3): the ticket till shares POOL-1's one physical drawer with the recharge
 * till, and whatever that pool's variance is at close lands entirely on the primary member
 * regardless of which till a leg names, so crediting `CASH_RECHARGE` for ticket-funded cash
 * is cosmetic, not a bookkeeping error.
 *
 * Picking a disclosed source **promotes** it to a visible chip, remembered in `localStorage`
 * **per category** — the same source may be promoted under one category and stay disclosed
 * under another, because the memory is "where this kind of expense usually comes from," not
 * a global reordering of the picker.
 *
 * ## No history, no "last 10", by design
 *
 * `VoucherController` has no `GET` mapping at all today — endpoints 10 and 11 do not exist —
 * so this screen shows nothing about what has already been recorded. That was raised on the
 * artboard itself (2026-11-23 comment thread) and settled there rather than guessed at here:
 * it needs a backend session and a slice decision first, recorded as future work in
 * `implementation-plan.md` §3.1.
 */
@Component({
  selector: 'app-expenses',
  templateUrl: './expenses.component.html',
  styleUrl: './expenses.component.scss'
})
export class ExpensesComponent implements OnInit, OnDestroy {
  categoryAccounts: AccountResponse[] = [];
  sourceAccounts: AccountResponse[] = [];
  customCategoryLabels: string[] = [];
  /** `{ [categoryKey]: accountCode[] }` — which disclosed sources have been promoted, per category. */
  promotedSources: Record<string, string[]> = {};

  loading = true;
  loadError = '';

  selectedCategoryKey = '';
  addingCategory = false;
  newCategoryInput = '';

  selectedSourceCode = '';
  sourceExpanded = false;

  /** What the operator typed, in rupees. Text rather than a number so "1,200" reads back. */
  amountInput = '';
  dateInput = todayIso();
  narration = '';

  submitting = false;
  submitError = '';
  result: VoucherResponse | null = null;

  private idempotencyKey = newIdempotencyKey();
  private readonly subscriptions = new Subscription();

  constructor(private api: AccountsApiService) {}

  ngOnInit(): void {
    this.customCategoryLabels = readStringArray(CUSTOM_CATEGORIES_KEY);
    this.promotedSources = readRecord(PROMOTED_SOURCES_KEY);
    this.load();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.subscriptions.add(
      forkJoin({
        categories: this.api.accounts({ manualOnly: true, type: 'EXPENSE' }),
        sources: this.api.accounts({ manualOnly: true, type: 'ASSET' })
      }).subscribe({
        next: ({ categories, sources }) => {
          this.loading = false;
          this.categoryAccounts = categories;
          // ⚠ CASH_TICKET dropped here and nowhere else — the server still accepts it.
          this.sourceAccounts = sources.filter((a) => a.accountCode !== CASH_TICKET);
          this.prefillDefaults();
        },
        error: (error) => {
          this.loading = false;
          this.loadError = errorSentence(error);
        }
      })
    );
  }

  private prefillDefaults(): void {
    if (!this.categoryChips.some((c) => c.key === this.selectedCategoryKey) && this.categoryChips.length) {
      this.selectCategory(this.categoryChips[0]);
    }
    if (!this.visibleSourceAccounts.some((a) => a.accountCode === this.selectedSourceCode)) {
      this.selectedSourceCode = this.visibleSourceAccounts[0]?.accountCode ?? '';
    }
  }

  // -- Categories: five seeded chips, plus whatever labels were typed before ------------

  get categoryChips(): CategoryChip[] {
    const seeded: CategoryChip[] = this.categoryAccounts.map((a) => ({
      key: a.accountCode,
      label: a.displayName,
      suffix: null,
      accountCode: a.accountCode,
      isCustom: false
    }));
    const custom: CategoryChip[] = this.customCategoryLabels.map((label) => ({
      key: customCategoryKey(label),
      label,
      suffix: this.sundrySuffix,
      accountCode: EXP_SUNDRY_SHOP,
      isCustom: true
    }));
    return [...seeded, ...custom];
  }

  /** `Sundry` — the first word of the real account's own name, never a literal. */
  private get sundrySuffix(): string | null {
    const sundry = this.categoryAccounts.find((a) => a.accountCode === EXP_SUNDRY_SHOP);
    return sundry ? firstWord(sundry.displayName) : null;
  }

  get selectedCategory(): CategoryChip | null {
    return this.categoryChips.find((c) => c.key === this.selectedCategoryKey) ?? null;
  }

  /** The real account a custom chip posts to — what the recorded panel must show instead of the label. */
  get selectedCategoryAccount(): AccountResponse | null {
    const selected = this.selectedCategory;
    if (!selected) {
      return null;
    }
    return this.categoryAccounts.find((a) => a.accountCode === selected.accountCode) ?? null;
  }

  selectCategory(chip: CategoryChip): void {
    this.selectedCategoryKey = chip.key;
    this.addingCategory = false;
    this.onFieldChanged();
    // The visible sources are per-category, so a source promoted elsewhere may not apply
    // here — fall back to a chip that is actually offered for the newly chosen category.
    if (!this.visibleSourceAccounts.some((a) => a.accountCode === this.selectedSourceCode)) {
      this.selectedSourceCode = this.visibleSourceAccounts[0]?.accountCode ?? '';
    }
  }

  startAddingCategory(): void {
    this.addingCategory = true;
    this.newCategoryInput = '';
  }

  cancelAddingCategory(): void {
    this.addingCategory = false;
    this.newCategoryInput = '';
  }

  get canAddCategory(): boolean {
    return this.newCategoryInput.trim().length > 0;
  }

  addCategory(): void {
    const label = this.newCategoryInput.trim().slice(0, 100);
    if (!label) {
      return;
    }
    if (!this.customCategoryLabels.some((existing) => existing.toLowerCase() === label.toLowerCase())) {
      this.customCategoryLabels = [...this.customCategoryLabels, label];
      writeStringArray(CUSTOM_CATEGORIES_KEY, this.customCategoryLabels);
    }
    this.addingCategory = false;
    this.newCategoryInput = '';
    const chip = this.categoryChips.find((c) => c.key === customCategoryKey(label));
    if (chip) {
      this.selectCategory(chip);
    }
  }

  // -- Sources: two chips by default, "Other source" discloses the rest -----------------

  /** `CASH_SAFE`, then `BANK_JANATA` — in that order, regardless of the server's sort order. */
  get primarySourceAccounts(): AccountResponse[] {
    return [CASH_SAFE, BANK_JANATA]
      .map((code) => this.sourceAccounts.find((a) => a.accountCode === code))
      .filter((a): a is AccountResponse => !!a);
  }

  private get promotedCodesForSelectedCategory(): string[] {
    const key = this.selectedCategoryKey;
    return key ? this.promotedSources[key] ?? [] : [];
  }

  /** The chips actually shown: the two primary ones, plus anything promoted for this category. */
  get visibleSourceAccounts(): AccountResponse[] {
    const primary = this.primarySourceAccounts;
    const primaryCodes = new Set(primary.map((a) => a.accountCode));
    const promoted = this.sourceAccounts.filter(
      (a) => this.promotedCodesForSelectedCategory.includes(a.accountCode) && !primaryCodes.has(a.accountCode)
    );
    return [...primary, ...promoted];
  }

  /** What "Other source" opens: everything not already shown. */
  get disclosableSourceAccounts(): AccountResponse[] {
    const visibleCodes = new Set(this.visibleSourceAccounts.map((a) => a.accountCode));
    return this.sourceAccounts.filter((a) => !visibleCodes.has(a.accountCode));
  }

  toggleSourceDisclosure(): void {
    this.sourceExpanded = !this.sourceExpanded;
  }

  selectSource(code: string): void {
    this.selectedSourceCode = code;
    this.sourceExpanded = false;
    this.onFieldChanged();
    this.promoteSourceForSelectedCategory(code);
  }

  private promoteSourceForSelectedCategory(code: string): void {
    if (code === CASH_SAFE || code === BANK_JANATA) {
      return;
    }
    const key = this.selectedCategoryKey;
    if (!key) {
      return;
    }
    const current = this.promotedSources[key] ?? [];
    if (!current.includes(code)) {
      this.promotedSources = { ...this.promotedSources, [key]: [...current, code] };
      writeRecord(PROMOTED_SOURCES_KEY, this.promotedSources);
    }
  }

  get selectedSourceAccount(): AccountResponse | null {
    return this.sourceAccounts.find((a) => a.accountCode === this.selectedSourceCode) ?? null;
  }

  /** Whether the source is one of the two tills — what the "if from the till" hint reads off. */
  get sourceIsATill(): boolean {
    return this.selectedSourceCode === CASH_RECHARGE || this.selectedSourceCode === CASH_WATER;
  }

  accountName(code: string): string {
    return (
      this.categoryAccounts.find((a) => a.accountCode === code)?.displayName
      ?? this.sourceAccounts.find((a) => a.accountCode === code)?.displayName
      ?? code
    );
  }

  trackByChipKey(_index: number, chip: CategoryChip): string {
    return chip.key;
  }

  trackByCode(_index: number, account: AccountResponse): string {
    return account.accountCode;
  }

  // -- Amount, date, narration -----------------------------------------------------------

  get amount(): number | null {
    return parseRupees(this.amountInput);
  }

  get amountIsUnreadable(): boolean {
    return this.amountInput.trim() !== '' && this.amount === null;
  }

  get dateInFuture(): boolean {
    return !!this.dateInput && this.dateInput > todayIso();
  }

  /**
   * What is actually sent. A custom category's label is the only place it is recorded, so
   * it prefixes whatever the operator typed, or stands alone when nothing else was typed.
   */
  get narrationToSend(): string {
    const typed = this.narration.trim();
    const custom = this.selectedCategory?.isCustom ? this.selectedCategory.label : '';
    const full = custom && typed ? `${custom}: ${typed}` : custom || typed;
    // `@NotBlank` and `@Size(max = 255)` — a 400 for either would be this screen's fault.
    return full.slice(0, 255);
  }

  onFieldChanged(): void {
    this.submitError = '';
    this.result = null;
  }

  get canSubmit(): boolean {
    return (
      !this.submitting
      && !!this.selectedCategory
      && !!this.selectedSourceCode
      && this.amount !== null
      && this.amount > 0
      && !!this.dateInput
      && !this.dateInFuture
      && this.narrationToSend.length > 0
    );
  }

  submit(): void {
    const category = this.selectedCategory;
    const amount = this.amount;
    if (!category || amount === null || !this.canSubmit) {
      return;
    }

    this.submitting = true;
    this.submitError = '';
    const request: PaymentRequest = {
      voucherDate: this.dateInput,
      expenseAccountCode: category.accountCode,
      sourceAccountCode: this.selectedSourceCode,
      amount,
      narration: this.narrationToSend
    };
    this.subscriptions.add(
      this.api.postPayment(request, this.idempotencyKey).subscribe({
        next: (response) => this.posted(response),
        error: (error) => {
          this.submitting = false;
          const replayed = asReplayedVoucher(error);
          if (replayed) {
            // Not an error. The server answered 409 carrying the voucher that already
            // exists, so the operator gets the figures rather than a refusal.
            this.posted(replayed);
            return;
          }
          this.submitError = errorSentence(error);
        }
      })
    );
  }

  private posted(response: VoucherResponse): void {
    this.submitting = false;
    this.result = response;
    this.amountInput = '';
    this.narration = '';
    // A new action next, whether this attempt just succeeded or had already succeeded
    // under this key — either way continuing to reuse it would carry the wrong identity
    // into whatever is typed next.
    this.idempotencyKey = newIdempotencyKey();
  }

  get resultWasReplay(): boolean {
    return !!this.result?.replayed;
  }

  /** The leg naming this account, for the receipt — one voucher never carries two. */
  legFor(voucher: VoucherResponse, accountCode: string): VoucherResponse['legs'][number] | null {
    return voucher.legs.find((l) => l.accountCode === accountCode) ?? null;
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

function firstWord(text: string): string {
  return text.split(/[-–]/)[0].trim();
}

function customCategoryKey(label: string): string {
  return `custom:${label.toLowerCase()}`;
}

// -- localStorage, wrapped: private browsing and a full quota both throw ------------------

function readStringArray(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeStringArray(key: string, value: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The chip just will not be remembered next time — nothing on this screen depends on it.
  }
}

function readRecord(key: string): Record<string, string[]> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function writeRecord(key: string, value: Record<string, string[]>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Same as above.
  }
}
