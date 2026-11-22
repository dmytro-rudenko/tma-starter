import type { Product } from '@pctea/tma-nest-payments';

export const products: Product[] = [
  // tma:shop:start
  {
    id: 'premium',
    kind: 'subscription',
    priceStars: () => 250,
    title: (lang) => ({ uk: 'Преміум', en: 'Premium' })[lang],
    description: (lang) =>
      ({
        uk: 'Доступ до преміум-контенту на 30 днів',
        en: 'Access to premium content for 30 days',
      })[lang],
  },
  {
    id: 'coffee',
    kind: 'one_time',
    priceStars: () => 50,
    repeatable: true,
    title: (lang) => ({ uk: 'Кава для автора', en: 'Coffee for the author' })[lang],
    description: (lang) =>
      ({ uk: 'Разова підтримка проєкту', en: 'One-time support for the project' })[lang],
  },
  // tma:shop:end
];
