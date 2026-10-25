/**
 * The tender half of the wire contract — the part that is not recharge's.
 *
 * These five types moved out of `recharge/model/recharge.models.ts` when the payment
 * block was extracted, and that file re-exports every one of them, so nothing that
 * already imported them had to change.
 *
 * ⚠ The split is the same one `next-session-s4.md` correction 2 makes on the server:
 * "lines sum exactly to a given total, at most one CREDIT line, customerId required on
 * CREDIT, cash tendered >= cash line" is the tender half and is shared; a basket's own
 * shape — a recharge line and its surcharge, a ticket's fare and commission — is not.
 * A screen settling a ticket sends these same lines against a different basket.
 *
 * ⚠ Amounts are `BigDecimal` on the server and arrive as JSON numbers. They are typed
 * as `number` here and never used to re-derive a figure the server already sent.
 */

/**
 * `domain/SettlementMethod.java`. The wire name differs from the column for credit:
 * the API says `CREDIT`, `rc_txn_payment.LINE_TYPE` holds `CRDT`. The mapping is the
 * server's; a screen only ever sees the wire name.
 */
export type SettlementMethod = 'CASH' | 'UPI' | 'CREDIT';

/** `request/SettlementLineRequest.java`. `amountTendered` is meaningful on CASH alone. */
export interface SettlementLineRequest {
  method: SettlementMethod;
  amount: number;
  amountTendered?: number;
  reference?: string;
  customerId?: number;
  note?: string;
}

/** `response/CreditCustomerResponse.java`. */
export interface CreditCustomerResponse {
  customerId: number;
  name: string;
  contactNumber: string;
  outstanding: number;
  advanceHeld: number;
  oldestDebtDays: number | null;
  warn: boolean;
}

/** `request/CreateCustomerRequest.java`. `lastName` is deliberately not required. */
export interface CreateCustomerRequest {
  firstName: string;
  lastName?: string;
  mobile: string;
}

/** `response/CreateCustomerRequestResult.java` — the 409 body when the mobile is taken. */
export interface CreateCustomerRequestResult {
  existingCustomerId: number;
  name: string;
  contactNumber: string;
}
