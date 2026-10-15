import { allocated, basketTotal, BasketLine, num, PaymentLine, toRechargeLines, toSettlementLines } from './basket';

/**
 * The surcharge tri-state is the rule most likely to be broken by a well-meaning
 * refactor, so it is asserted directly: "omit the field to take the configured default;
 * send 0.00 to clear it. Those are different."
 */
describe('basket', () => {
  const tvLine = (surcharge?: number): BasketLine => ({
    serviceType: 'TV',
    number: '02700000001',
    operatorCode: 'DISHTV',
    operatorName: 'Dish Tv',
    amount: 240,
    surcharge
  });

  describe('toRechargeLines — the surcharge tri-state', () => {
    it('omits surcharge entirely when it was never touched, so the server defaults it', () => {
      const [line] = toRechargeLines([tvLine(undefined)]);
      expect('surcharge' in line).toBe(false);
    });

    it('sends an explicit zero when the staff cleared the field', () => {
      // §15.11: the field stays editable and "the owner was explicit", so a cleared DTH
      // charge must survive the round trip rather than coming back as ₹10.
      const [line] = toRechargeLines([tvLine(0)]);
      expect(line.surcharge).toBe(0);
    });

    it('sends an edited surcharge as typed', () => {
      const [line] = toRechargeLines([tvLine(20)]);
      expect(line.surcharge).toBe(20);
    });

    it('never sends a routeCode — the route is server-owned until completion', () => {
      const [line] = toRechargeLines([tvLine(10)]);
      expect('routeCode' in line).toBe(false);
    });

    it('sends no total and no status', () => {
      const [line] = toRechargeLines([tvLine(10)]);
      expect(Object.keys(line).sort()).toEqual(
        ['amount', 'number', 'operatorCode', 'serviceType', 'surcharge'].sort()
      );
    });
  });

  describe('toSettlementLines', () => {
    it('puts amountTendered on cash only', () => {
      const lines: PaymentLine[] = [
        { method: 'CASH', amount: 300, amountTendered: 500 },
        { method: 'UPI', amount: 100, amountTendered: 999 as unknown as number }
      ];
      const [cash, upi] = toSettlementLines(lines);
      expect(cash.amountTendered).toBe(500);
      expect('amountTendered' in upi).toBe(false);
    });

    it('requires a customer id on a credit line and carries the note', () => {
      const lines: PaymentLine[] = [
        {
          method: 'CREDIT',
          amount: 49,
          note: 'will pay Friday',
          customer: {
            customerId: 403,
            name: 'R. Pawar',
            contactNumber: '9960448201',
            outstanding: 340,
            advanceHeld: 0,
            oldestDebtDays: 54,
            warn: true
          }
        }
      ];
      const [credit] = toSettlementLines(lines);
      expect(credit.customerId).toBe(403);
      expect(credit.note).toBe('will pay Friday');
    });
  });

  describe('totals, in paise so a float never drifts', () => {
    it('adds the configured default when a line carries no surcharge of its own', () => {
      const total = basketTotal([tvLine(undefined)], () => 10);
      expect(total).toBe(250);
    });

    it('respects an explicit zero rather than substituting the default', () => {
      const total = basketTotal([tvLine(0)], () => 10);
      expect(total).toBe(240);
    });

    it('sums 0.1-style amounts without drift', () => {
      const lines: BasketLine[] = [
        { ...tvLine(0), amount: 0.1 },
        { ...tvLine(0), amount: 0.2 }
      ];
      expect(basketTotal(lines, () => 0)).toBe(0.3);
    });

    it('allocates across payment lines', () => {
      expect(allocated([
        { method: 'CASH', amount: 300 },
        { method: 'UPI', amount: 100 },
        { method: 'CREDIT', amount: 49 }
      ])).toBe(449);
    });
  });

  /**
   * ⚠ REGRESSION. `[(ngModel)]` on a text input writes back a STRING, so a typed split
   * sent `{"amount":"100"}` and `{"amount":"199"}`. The screen's own "left to allocate"
   * read ₹0.00 because JavaScript coerces for `*`, and the server then refused the basket
   * with `providedTotal: 100199` — string concatenation. Found by clicking through it,
   * invisible to every test that set the amounts as numbers.
   */
  describe('figures typed into a text input arrive as strings', () => {
    it('sends amounts as JSON numbers, not as the strings ngModel wrote', () => {
      const lines: PaymentLine[] = [
        { method: 'CASH', amount: '100', amountTendered: '100' },
        { method: 'CREDIT', amount: '199', customer: {
          customerId: 512, name: 'Anil Pawar', contactNumber: '9823551740',
          outstanding: 49, advanceHeld: 0, oldestDebtDays: 6, warn: false } }
      ];
      const [cash, credit] = toSettlementLines(lines);
      expect(cash.amount).toBe(100);
      expect(cash.amountTendered).toBe(100);
      expect(credit.amount).toBe(199);
      expect(typeof credit.amount).toBe('number');
    });

    it('adds string amounts rather than concatenating them', () => {
      expect(allocated([
        { method: 'CASH', amount: '100' },
        { method: 'CREDIT', amount: '199' }
      ])).toBe(299);
    });

    it('leaves an untyped tender off the request rather than sending an empty string', () => {
      const [cash] = toSettlementLines([{ method: 'CASH', amount: '299', amountTendered: '' }]);
      expect('amountTendered' in cash).toBe(false);
    });

    it('reads a blank or unparseable figure as zero', () => {
      expect(num('')).toBe(0);
      expect(num('   ')).toBe(0);
      expect(num('abc')).toBe(0);
      expect(num(null)).toBe(0);
      expect(num(undefined)).toBe(0);
      expect(num('199')).toBe(199);
      expect(num(' 199.50 ')).toBe(199.5);
      expect(num(199)).toBe(199);
    });
  });
});
