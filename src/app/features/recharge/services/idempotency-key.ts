/**
 * One key per basket.
 *
 * `POST /recharge/transactions` requires `Idempotency-Key` and answers 400 without one
 * (`RechargeController.java:208-214`). Sending the same key twice returns 200 with the
 * original transaction rather than an error, so the rule the counter follows is:
 * generate one when a basket starts, keep it across every retry, and mint a new one
 * only when the basket itself changes. That is what makes retrying after a timeout safe
 * — the alternative is a second charge for one sale.
 */
export function newIdempotencyKey(): string {
  // Available in every browser this app supports; the fallback covers a non-secure
  // context, where crypto.randomUUID is not exposed.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
