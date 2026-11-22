import { DynamicModule, Module, ModuleMetadata } from '@nestjs/common';
import { TmaBotModule } from 'tma-starter/nest-bot';
import { TmaCoreModule } from 'tma-starter/nest-core';
import { TmaPaymentsModule } from 'tma-starter/nest-payments';
import type { Knex } from 'knex';
import { validateEnv } from './config/env';
import { ExampleModule } from './features/example/example.module';
import { products } from './products';
// tma:shop:start
import { ShopModule } from './shop/shop.module';
// tma:shop:end

export interface AppContext {
  knex: Knex;
  botToken: string;
  apiRoot?: string;
  env?: Record<string, unknown>;
}

export function appImports(ctx: AppContext): NonNullable<ModuleMetadata['imports']> {
  const env = validateEnv(ctx.env ?? process.env);
  return [
    TmaCoreModule.forRoot({
      knex: ctx.knex,
      botToken: ctx.botToken,
      adminUserIds: env.ADMIN_USER_IDS,
      initDataMaxAgeSec: env.INIT_DATA_MAX_AGE_SEC,
      runWorker: env.RUN_WORKER,
      throttle: { ttlMs: 60_000, limit: env.API_RATE_LIMIT },
    }),
    TmaBotModule.forRoot({
      botToken: ctx.botToken,
      botUsername: env.BOT_USERNAME,
      webappUrl: env.WEBAPP_URL,
      webhookPathToken: env.WEBHOOK_PATH_TOKEN,
      webhookSecret: env.WEBHOOK_SECRET,
      apiRoot: ctx.apiRoot ?? env.BOT_API_ROOT,
      runWorker: env.RUN_WORKER,
    }),
    TmaPaymentsModule.forRoot({ products, runWorker: env.RUN_WORKER }),
    ExampleModule,
    // tma:shop:start
    ShopModule,
    // tma:shop:end
  ];
}

@Module({})
export class AppModule {
  static forRoot(ctx: AppContext): DynamicModule {
    return { module: AppModule, imports: appImports(ctx) };
  }
}
