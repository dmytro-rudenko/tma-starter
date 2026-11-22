import { Controller, Get, UseGuards } from '@nestjs/common';
import { langOf } from '@dmytro-rudenko/tma-nest-bot';
import { AuthUser, CurrentUser, UsersService } from '@dmytro-rudenko/tma-nest-core';
import { EntitlementGuard } from '@dmytro-rudenko/tma-nest-payments';

const ITEMS = {
  uk: ['Ексклюзивний гайд', 'Закрита добірка', 'Ранній доступ до новинок'],
  en: ['Exclusive guide', 'Private collection', 'Early access to new releases'],
};

@Controller('api/premium')
export class PremiumController {
  constructor(private readonly users: UsersService) {}

  @Get('content')
  @UseGuards(EntitlementGuard('premium'))
  async content(@CurrentUser() user: AuthUser): Promise<{ items: string[] }> {
    const stored = await this.users.get(user.id);
    return { items: ITEMS[langOf(stored?.language ?? user.languageCode)] };
  }
}
