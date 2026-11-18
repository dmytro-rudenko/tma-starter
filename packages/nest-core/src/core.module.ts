import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminAuditController } from './admin/admin-audit.controller';
import { AdminSettingsController } from './admin/admin-settings.controller';
import { AdminUserCardRegistry } from './admin/admin-user-card.registry';
import { AdminUsersController } from './admin/admin-users.controller';
import { AdminGuard } from './admin-rights/admin.guard';
import { AdminRightsService } from './admin-rights/admin-rights.service';
import { APP_SETTINGS_CLOCK, AppSettingsService } from './app-settings/app-settings.service';
import { AppSettingsRegistry } from './app-settings/registry';
import { AuditService } from './audit/audit.service';
import { TelegramAuthGuard } from './auth/telegram-auth.guard';
import { UserThrottlerGuard } from './common/user-throttler.guard';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';
import { resolveCoreOptions, TmaCoreOptions } from './options';
import { TmaRealtimeGateway } from './realtime/realtime.gateway';
import { RealtimeService } from './realtime/realtime.service';
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
      controllers: [
        HealthController,
        MeController,
        AdminUsersController,
        AdminSettingsController,
        AdminAuditController,
      ],
      providers: [
        { provide: TMA_KNEX, useValue: opts.knex },
        { provide: TMA_CORE_OPTIONS, useValue: resolved },
        { provide: APP_SETTINGS_CLOCK, useValue: (): number => Date.now() },
        AuditService,
        UsersService,
        AdminRightsService,
        AdminGuard,
        AppSettingsRegistry,
        AppSettingsService,
        AdminUserCardRegistry,
        RealtimeService,
        TmaRealtimeGateway,
        { provide: APP_GUARD, useClass: TelegramAuthGuard },
        { provide: APP_GUARD, useClass: UserThrottlerGuard },
      ],
      exports: [
        TMA_KNEX,
        TMA_CORE_OPTIONS,
        APP_SETTINGS_CLOCK,
        AuditService,
        UsersService,
        AdminRightsService,
        AdminGuard,
        AppSettingsRegistry,
        AppSettingsService,
        AdminUserCardRegistry,
        RealtimeService,
      ],
    };
  }
}
