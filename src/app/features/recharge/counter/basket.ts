import {
  CreditCustomerResponse,
  RechargeLineRequest,
  ServiceType,
  SettlementLineRequest,
  SettlementMethod
} from '../model/recharge.models';

/**
 * One recharge in the basket.
 *
 * The basket is a strip, not a grid: §14.10 measured 920 FY2026-27 baskets holding one
 * recharge, 57 holding two and 1 holding three. Nothing has ever held more, so there is
 * no scroll area, no column headers and no line numbers. The server's own ceiling is 20
 * (`SettleBasketRequest.java:11`).
 */
export interface BasketLine {
  serviceType: ServiceType;
  number: string;
  operatorCode: string;
  operatorName: string;
  amount: number;

  /**
   * ⚠ Tri-state, and the two zeroes are different things. `undefined` means "take the
   * configured default" and is sent by omitting the field; `0` means the staff cleared
   * it and is sent explicitly. §15.11 item 3 keeps the field editable — "the staff can
   * change or clear it. The owner was explicit" — so a cleared DTH charge must survive
   * the round trip rather than silently come back as ₹10.
   */
  surcharge?: number;

  /** TV only, for the strip's second line: whose connection this is. */
  connectionName?: string;

  /**
   * The operator's default route, for display only. The server fills the real one at
   * settlement and it is overridden at completion (§14.6) — at the moment the customer
   * pays nobody yet knows which connection will be used, so this is a label, not data.
   */
  defaultRouteName?: string;
}

/** One row of the payment panel. Normally there is exactly one, and it is cash. */
export interface PaymentLine {
  method: SettlementMethod;
  amount: number | null;
  /** CASH only — `SettlementMethod.carriesTender()`. */
  amountTendered?: number | null;
  /** UPI only. */
  reference?: string;
  /** CREDIT only, and required for it. */
  customer?: CreditCustomerResponse;
  note?: string;
}

/**
 * What the basket comes to, for display before it is settled.
 *
 * This is NOT a re-derivation of a server-owned figure: until the settle call there is
 * no server total to disagree with, and artboard 1 draws "Total due ₹299.00" beside the
 * strip. `design-api.md` §3.3 recomputes `totalDue` server-side precisely so the client
 * cannot send one — and after the call the screen shows the response's `totalDue`, never
 * this. Keeping both straight is the whole point of having two functions.
 */
export function basketTotal(lines: BasketLine[], defaultSurcharge: (line: BasketLine) => number): number {
  const paise = lines.reduce((sum, line) => {
    const surcharge = line.surcharge ?? defaultSurcharge(line);
    return sum + Math.round(line.amount * 100) + Math.round(surcharge * 100);
  }, 0);
  return paise / 100;
}

/** What the payment lines currently account for. */
export function allocated(lines: PaymentLine[]): number {
  const paise = lines.reduce((sum, line) => sum + Math.round((line.amount ?? 0) * 100), 0);
  return paise / 100;
}

/**
 * The request body. No total, no change, no status and no `routeCode` — all four are
 * server-owned, so the client has nothing to disagree with (§3.3).
 */
export function toRechargeLines(lines: BasketLine[]): RechargeLineRequest[] {
  return lines.map((line) => {
    const request: RechargeLineRequest = {
      serviceType: line.serviceType,
      number: line.number,
      operatorCode: line.operatorCode,
      amount: line.amount
    };
    // Omitted when undefined, which is how "take the configured default" is expressed.
    // An explicit 0 is kept, which is how "the staff cleared it" is expressed.
    if (line.surcharge !== undefined) {
      request.surcharge = line.surcharge;
    }
    return request;
  });
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
    const request: SettlementLineRequest = {
      method: line.method,
      amount: line.amount ?? 0
    };
    if (line.method === 'CASH' && line.amountTendered != null) {
      request.amountTendered = line.amountTendered;
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
