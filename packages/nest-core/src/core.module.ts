import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminGuard } from './admin-rights/admin.guard';
import { AdminRightsService } from './admin-rights/admin-rights.service';
import { TelegramAuthGuard } from './auth/telegram-auth.guard';
import { UserThrottlerGuard } from './common/user-throttler.guard';
import { HealthController } from './health/health.controller';
import { resolveCoreOptions, TmaCoreOptions } from './options';
import { TMA_CORE_OPTIONS, TMA_KNEX } from './tokens';
import { UsersService } from './users/users.service';

@Global()
@Module({})
export class TmaCoreModule {
  static forRoot(opts: TmaCoreOptions): DynamicModule {
    if (!opts?.knex) throw new Error('TmaCoreModule.forRoot: knex is required');
    if (!opts.botToken) throw new Error('TmaCoreModule.forRoot: botToken is required');
    const resolved = resolveCoreOptions(opts);
    return {
      module: TmaCoreModule,
      imports: [
        ThrottlerModule.forRoot([{ ttl: resolved.throttle.ttlMs, limit: resolved.throttle.limit }]),
      ],
      controllers: [HealthController],
      providers: [
        { provide: TMA_KNEX, useValue: opts.knex },
        { provide: TMA_CORE_OPTIONS, useValue: resolved },
        UsersService,
        AdminRightsService,
        AdminGuard,
        { provide: APP_GUARD, useClass: TelegramAuthGuard },
        { provide: APP_GUARD, useClass: UserThrottlerGuard },
      ],
      exports: [TMA_KNEX, TMA_CORE_OPTIONS, UsersService, AdminRightsService, AdminGuard],
    };
  }
}
