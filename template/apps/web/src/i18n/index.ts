import { createI18n, type Lang } from '@pctea/tma/web';
import en from './en.json';
import uk from './uk.json';
// tma:shop:start
import shopEn from './shop.en.json';
import shopUk from './shop.uk.json';
// tma:shop:end

export const { i18n } = createI18n<Lang>({
  resources: {
    uk: {
      translation: {
        ...uk,
        // tma:shop:start
        ...shopUk,
        // tma:shop:end
      },
    },
    en: {
      translation: {
        ...en,
        // tma:shop:start
        ...shopEn,
        // tma:shop:end
      },
    },
  },
  supported: ['uk', 'en'],
  fallback: '__DEFAULT_LANG__',
});
