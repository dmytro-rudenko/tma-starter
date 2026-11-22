import { ApiError, type TmaApiErrorCode } from 'tma-starter/web';
import { useTranslation } from 'react-i18next';

export type AppErrorCode = never;

type ErrorCode = TmaApiErrorCode | AppErrorCode;
type TextLang = 'uk' | 'en';

export const errorText: Record<TextLang, Record<ErrorCode, string>> = {
  uk: {
    UNAUTHORIZED: 'Потрібна авторизація. Відкрийте застосунок з Telegram.',
    USER_BLOCKED: 'Ваш акаунт заблоковано.',
    NOT_ADMIN: 'Потрібні права адміністратора.',
    USER_NOT_FOUND: 'Користувача не знайдено.',
    CANNOT_BLOCK_ADMIN: 'Адміністратора не можна заблокувати. Спершу заберіть у нього права.',
    CANNOT_GRANT_BLOCKED: 'Заблокованому користувачу не можна дати права адміністратора.',
    CANNOT_REVOKE_ENV_ADMIN: 'Права адміністратора із серверних налаштувань не можна забрати тут.',
    CANNOT_TARGET_SELF: 'Цю дію не можна застосувати до себе.',
    UNKNOWN_SETTING: 'Невідоме налаштування.',
    VALIDATION: 'Некоректне значення. Перевірте введені дані.',
    RATE_LIMITED: 'Забагато запитів. Спробуйте за хвилину.',
    BROADCAST_NOT_FOUND: 'Розсилку не знайдено.',
    NO_ENTITLEMENT: 'Цей вміст доступний лише з активним доступом.',
    PRODUCT_NOT_FOUND: 'Продукт не знайдено.',
    PRODUCT_UNAVAILABLE: 'Цей продукт зараз недоступний.',
    ALREADY_SUBSCRIBED: 'Підписку вже оформлено.',
    ALREADY_OWNED: 'Цей продукт уже активний на акаунті.',
    ENTITLEMENT_HELD_BY_SUBSCRIPTION:
      'Цей доступ дає активна підписка. Видати його можна після того, як вона закінчиться.',
    NO_SUBSCRIPTION: 'Активної підписки немає.',
    PAYMENT_NOT_FOUND: 'Платіж не знайдено.',
    ALREADY_REFUNDED: 'Цей платіж уже повернуто.',
    PAYMENT_PROVIDER_UNAVAILABLE: 'Telegram зараз недоступний. Спробуйте пізніше.',
  },
  en: {
    UNAUTHORIZED: 'Authorization required. Open the app from Telegram.',
    USER_BLOCKED: 'Your account is blocked.',
    NOT_ADMIN: 'Administrator rights are required.',
    USER_NOT_FOUND: 'User not found.',
    CANNOT_BLOCK_ADMIN: 'An administrator cannot be blocked. Revoke their rights first.',
    CANNOT_GRANT_BLOCKED: 'A blocked user cannot be made an administrator.',
    CANNOT_REVOKE_ENV_ADMIN:
      'Administrator rights set in the server config cannot be revoked here.',
    CANNOT_TARGET_SELF: 'This action cannot be applied to yourself.',
    UNKNOWN_SETTING: 'Unknown setting.',
    VALIDATION: 'Invalid value. Check what you entered.',
    RATE_LIMITED: 'Too many requests. Try again in a minute.',
    BROADCAST_NOT_FOUND: 'Broadcast not found.',
    NO_ENTITLEMENT: 'This content needs an active access.',
    PRODUCT_NOT_FOUND: 'Product not found.',
    PRODUCT_UNAVAILABLE: 'This product is not available right now.',
    ALREADY_SUBSCRIBED: 'You are already subscribed.',
    ALREADY_OWNED: 'This product is already active on the account.',
    ENTITLEMENT_HELD_BY_SUBSCRIPTION:
      'This access comes from an active subscription. It can be granted once the subscription ends.',
    NO_SUBSCRIPTION: 'There is no active subscription.',
    PAYMENT_NOT_FOUND: 'Payment not found.',
    ALREADY_REFUNDED: 'This payment is already refunded.',
    PAYMENT_PROVIDER_UNAVAILABLE: 'Telegram is unavailable right now. Try again later.',
  },
};

const genericText: Record<TextLang, string> = {
  uk: 'Щось пішло не так. Спробуйте ще раз.',
  en: 'Something went wrong. Try again.',
};

export function errorMessage(e: unknown, lang: string): string {
  const l: TextLang = lang === 'uk' ? 'uk' : 'en';
  if (e instanceof ApiError && Object.hasOwn(errorText[l], e.code)) {
    return errorText[l][e.code as ErrorCode];
  }
  return genericText[l];
}

export function useErrorMessage(): (e: unknown) => string {
  const { i18n } = useTranslation();
  return (e) => errorMessage(e, i18n.language);
}
