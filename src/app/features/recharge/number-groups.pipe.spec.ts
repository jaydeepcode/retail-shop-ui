import { NumberGroupsPipe } from './number-groups.pipe';

describe('NumberGroupsPipe', () => {
  const pipe = new NumberGroupsPipe();

  it('groups a ten-digit mobile 4-3-3, as artboard 1 draws it', () => {
    expect(pipe.transform('9430043541', 'MOBILE')).toEqual(['9430', '043', '541']);
  });

  it('groups a mobile even when the service type is not given', () => {
    expect(pipe.transform('9823014772')).toEqual(['9823', '014', '772']);
  });

  /**
   * ⚠ A TV connection number is an ACCOUNT number: `02700431198` is eleven digits and
   * `0281190077` is ten, and neither has a convention. Grouping would invent structure.
   */
  it('leaves a TV connection number whole', () => {
    expect(pipe.transform('02700431198', 'TV')).toEqual(['02700431198']);
    expect(pipe.transform('0281190077', 'TV')).toEqual(['0281190077']);
  });

  it('leaves anything that is not ten digits whole', () => {
    expect(pipe.transform('98230')).toEqual(['98230']);
    expect(pipe.transform('123456789012')).toEqual(['123456789012']);
  });

  it('is empty for an empty number rather than producing a stray group', () => {
    expect(pipe.transform('')).toEqual([]);
    expect(pipe.transform(null)).toEqual([]);
    expect(pipe.transform(undefined)).toEqual([]);
  });

  it('regroups a number that already carries spaces', () => {
    expect(pipe.transform('9430 043 541', 'MOBILE')).toEqual(['9430', '043', '541']);
  });

  /** The groups must rejoin to exactly the digits the server holds. */
  it('loses nothing: the groups rejoin to the original', () => {
    for (const number of ['9430043541', '9823014772', '02700431198', '98230']) {
      expect(pipe.transform(number).join('')).toBe(number);
    }
  });
});
