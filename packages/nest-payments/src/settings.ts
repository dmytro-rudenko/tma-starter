import { defineSetting } from '@dmytro-rudenko/tma-nest-core';

export const PAYMENTS_TEST_USERS = defineSetting<number[]>({
  key: 'payments.test_users',
  default: [],
  parse(v: unknown): number[] {
    if (!Array.isArray(v) || !v.every((id) => Number.isSafeInteger(id) && id > 0)) {
      throw new Error('payments.test_users must be an array of user ids');
    }
    return v as number[];
  },
});
