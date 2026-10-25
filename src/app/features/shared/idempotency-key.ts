/**
 * One key per sale, for any endpoint that writes money.
 *
 * `POST /recharge/transactions` and `POST /tickets/bookings` both require an
 * `Idempotency-Key` and answer 400 without one. Sending the same key twice returns 200
 * with the original rather than an error, so the rule both screens follow is: generate
 * one when the sale starts, keep it across every retry, and mint a new one only when
 * what is being sold changes. That is what makes retrying after a timeout safe — the
 * alternative is a second charge for one sale.
 *
 * ⚠ Moved out of `recharge/services/` for S4, because the ticket screen needs exactly
 * this and a copy would drift. The server-side halves are separate on purpose:
 * recharge keys into `rc_idempotency`, a booking carries its own key on the row
 * (V33), and neither can hold the other's id.
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
