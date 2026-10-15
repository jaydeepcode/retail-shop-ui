import { Pipe, PipeTransform } from '@angular/core';
import { ServiceType } from './model/recharge.models';

/**
 * A number split into the groups it should be read in.
 *
 * The number on screen is the one staff retype into the operator's app, so a misread is
 * a recharge to the wrong person — a void and a refund. Chunking is what makes a ten
 * digit run transcribable, and 4-3-3 is the grouping artboard 1's entry field already
 * draws (`9823 014 772`).
 *
 * ⚠ MOBILES ONLY. A TV connection number is an account number — `02700431198` is eleven
 * digits and `0281190077` is ten, and neither has a convention behind it. Grouping those
 * would invent a structure the number does not have, so they come back as one group.
 *
 * ⚠ The groups are rendered as adjacent elements with a CSS gap, never joined with
 * spaces, so selecting the number and pasting it into the operator's app yields
 * `9430043541` and not `9430 043 541`. Some operator apps refuse the spaced form, and
 * pasting is the likely workflow now that there is a copy button beside it.
 */
@Pipe({ name: 'numberGroups' })
export class NumberGroupsPipe implements PipeTransform {
  transform(value: string | null | undefined, serviceType?: ServiceType): string[] {
    const digits = (value ?? '').replace(/\s/g, '');
    if (!digits) {
      return [];
    }
    if (serviceType === 'TV' || !/^[0-9]{10}$/.test(digits)) {
      return [digits];
    }
    return [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7)];
  }
}
