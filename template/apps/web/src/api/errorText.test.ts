import { ApiError, TMA_ERROR_CODES } from '@pctea/tma/web';
import { describe, expect, it } from 'vitest';
import { errorMessage, errorText } from './errorText';

describe.each(['uk', 'en'] as const)('errorText.%s', (lang) => {
  it.each(TMA_ERROR_CODES)('%s has a non-empty human text', (code) => {
    const text = errorText[lang][code];
    expect(typeof text).toBe('string');
    expect(text.trim()).not.toBe('');
    expect(text).not.toContain(code);
  });
});

describe('errorMessage', () => {
  it('maps an ApiError code to its text in the given language, never the raw server message', () => {
    const e = new ApiError(400, 'VALIDATION', 'payments.test_users must be an array of user ids');
    expect(errorMessage(e, 'uk')).toBe(errorText.uk.VALIDATION);
    expect(errorMessage(e, 'en')).toBe(errorText.en.VALIDATION);
  });

  it('treats every language other than uk as en', () => {
    const e = new ApiError(403, 'NOT_ADMIN', 'not admin');
    expect(errorMessage(e, 'ru')).toBe(errorText.en.NOT_ADMIN);
  });

  it('falls back to one generic non-empty text for unknown codes and non-API errors', () => {
    const generic = errorMessage(new ApiError(500, 'HTTP_500', 'boom'), 'en');
    expect(generic.trim()).not.toBe('');
    expect(generic).not.toBe('boom');
    expect(errorMessage(new TypeError('Failed to fetch'), 'en')).toBe(generic);
    expect(errorMessage('weird', 'en')).toBe(generic);
  });
});

describe('errorText for codes an admin grant shares with a purchase', () => {
  it('ALREADY_OWNED does not address the reader as the owner', () => {
    expect(errorText.uk.ALREADY_OWNED).not.toMatch(/у вас/i);
    expect(errorText.en.ALREADY_OWNED).not.toMatch(/\byou\b/i);
  });

  it('ENTITLEMENT_HELD_BY_SUBSCRIPTION does not promise that cancelling unblocks the grant', () => {
    expect(errorText.uk.ENTITLEMENT_HELD_BY_SUBSCRIPTION).not.toMatch(/скасуйте/i);
    expect(errorText.en.ENTITLEMENT_HELD_BY_SUBSCRIPTION).not.toMatch(/cancel/i);
  });
});
