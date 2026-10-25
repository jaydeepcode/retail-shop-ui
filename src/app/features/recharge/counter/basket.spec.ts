import { basketTotal, BasketLine, toRechargeLines } from './basket';

/**
 * The surcharge tri-state is the rule most likely to be broken by a well-meaning
 * refactor, so it is asserted directly: "omit the field to take the configured default;
 * send 0.00 to clear it. Those are different."
 *
 * ⚠ The tender half of these tests moved to `shared/payment/tender.spec.ts` with the
 * code they cover — `toSettlementLines`, `allocated` and `num`, including the
 * strings-from-ngModel regression. Every assertion went across verbatim.
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
  });
});
