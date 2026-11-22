import type { Product } from './product';

const ID_RE = /^[a-z0-9_]{1,24}$/;
const KINDS: readonly string[] = ['one_time', 'subscription'];
const LANGS = ['uk', 'en'] as const;

function chars(s: unknown): number {
  return typeof s === 'string' ? [...s].length : -1;
}

export class ProductRegistry {
  private readonly products = new Map<string, Product>();

  constructor(products: readonly Product[]) {
    for (const p of products) {
      const fail = (why: string): never => {
        throw new Error(`ProductRegistry: product "${String(p.id)}" ${why}`);
      };
      if (typeof p.id !== 'string' || !ID_RE.test(p.id)) fail('has an invalid id');
      if (this.products.has(p.id)) fail('is registered twice');
      if (!KINDS.includes(p.kind)) fail(`has an unknown kind "${String(p.kind)}"`);
      if (p.lock && !p.settle) fail('has lock without settle');
      for (const lang of LANGS) {
        const title = chars(p.title(lang));
        if (title < 1 || title > 32) fail(`title (${lang}) must be 1-32 characters`);
        const description = chars(p.description(lang));
        if (description < 1 || description > 255) {
          fail(`description (${lang}) must be 1-255 characters`);
        }
      }
      this.products.set(p.id, p);
    }
  }

  get(id: string): Product | undefined {
    return this.products.get(id);
  }

  ids(): string[] {
    return [...this.products.keys()];
  }

  all(): Product[] {
    return [...this.products.values()];
  }
}
