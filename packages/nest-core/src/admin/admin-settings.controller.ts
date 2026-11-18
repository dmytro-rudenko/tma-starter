import { Body, Controller, Get, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin-rights/admin.guard';
import { AppSettingsService, AppSettingView } from '../app-settings/app-settings.service';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { apiError } from '../common/api-error';

@Controller('api/admin/settings')
@UseGuards(AdminGuard)
export class AdminSettingsController {
  constructor(private readonly settings: AppSettingsService) {}

  @Get()
  list(): Promise<AppSettingView[]> {
    return this.settings.list();
  }

  @Patch()
  async update(@CurrentUser() admin: AuthUser, @Body() body: unknown): Promise<AppSettingView[]> {
    const { key, value } = (body ?? {}) as { key?: unknown; value?: unknown };
    if (typeof key !== 'string' || key === '') {
      throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'key must be a non-empty string');
    }
    await this.settings.set(admin.id, key, value);
    return this.settings.list();
  }
}
