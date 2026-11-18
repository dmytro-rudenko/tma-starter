export interface StartParamRoute {
  pattern: RegExp;
  handle(ctx: any, match: RegExpMatchArray): Promise<void> | void;
}

export class StartParamRouter {
  constructor(private readonly routes: readonly StartParamRoute[]) {}

  async route(ctx: unknown, param: string | null | undefined): Promise<boolean> {
    if (!param) return false;
    for (const route of this.routes) {
      route.pattern.lastIndex = 0;
      const match = route.pattern.exec(param);
      if (match) {
        await route.handle(ctx, match);
        return true;
      }
    }
    return false;
  }
}
