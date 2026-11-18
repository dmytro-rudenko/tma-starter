import { StartParamRoute, StartParamRouter } from './start-param.router';

type Call = { route: string; ctx: unknown; match: string[] };

function recorder(calls: Call[], name: string, pattern: RegExp): StartParamRoute {
  return {
    pattern,
    handle: async (ctx: any, match: RegExpMatchArray) => {
      calls.push({ route: name, ctx, match: [...match] });
    },
  };
}

describe('StartParamRouter', () => {
  const ctx = { tag: 'ctx' };

  it('calls only the first matching route with ctx and the regex match', async () => {
    const calls: Call[] = [];
    const router = new StartParamRouter([
      recorder(calls, 'item', /^shop_(\d+)$/),
      recorder(calls, 'shop', /^shop/),
    ]);

    expect(await router.route(ctx, 'shop_42')).toBe(true);
    expect(calls).toEqual([{ route: 'item', ctx, match: ['shop_42', '42'] }]);
  });

  it('falls through to a later route when earlier patterns do not match', async () => {
    const calls: Call[] = [];
    const router = new StartParamRouter([
      recorder(calls, 'item', /^shop_(\d+)$/),
      recorder(calls, 'shop', /^shop/),
    ]);

    expect(await router.route(ctx, 'shopping')).toBe(true);
    expect(calls).toEqual([{ route: 'shop', ctx, match: ['shop'] }]);
  });

  it('returns false and calls nothing when no route matches', async () => {
    const calls: Call[] = [];
    const router = new StartParamRouter([recorder(calls, 'shop', /^shop$/)]);

    expect(await router.route(ctx, 'unknown')).toBe(false);
    expect(await router.route(ctx, '')).toBe(false);
    expect(await router.route(ctx, undefined)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('returns false with no routes', async () => {
    expect(await new StartParamRouter([]).route(ctx, 'shop')).toBe(false);
  });

  it('awaits the handler before resolving', async () => {
    const done: string[] = [];
    const router = new StartParamRouter([
      {
        pattern: /^slow$/,
        handle: async () => {
          await new Promise((r) => setTimeout(r, 20));
          done.push('slow');
        },
      },
    ]);

    await router.route(ctx, 'slow');
    expect(done).toEqual(['slow']);
  });

  it('propagates a handler error', async () => {
    const router = new StartParamRouter([
      {
        pattern: /^boom$/,
        handle: async () => {
          throw new Error('route failed');
        },
      },
    ]);

    await expect(router.route(ctx, 'boom')).rejects.toThrow('route failed');
  });
});
