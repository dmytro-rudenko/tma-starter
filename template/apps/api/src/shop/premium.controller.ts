import { Controller, Get, UseGuards } from '@nestjs/common';
import { EntitlementGuard } from '@dmytro-rudenko/tma-nest-payments';

@Controller('api/premium')
export class PremiumController {
  @Get('content')
  @UseGuards(EntitlementGuard('premium'))
  content(): { items: string[] } {
    return { items: ['Ексклюзивний гайд', 'Закрита добірка', 'Ранній доступ до новинок'] };
  }
}
