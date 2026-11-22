import { Controller, Get } from '@nestjs/common';
import { langOf } from '@dmytro-rudenko/tma-nest-bot';
import { AuthUser, CurrentUser, UsersService } from '@dmytro-rudenko/tma-nest-core';

const GREETING = {
  uk: (name: string) => `Привіт, ${name}!`,
  en: (name: string) => `Hello, ${name}!`,
};

@Controller('api/example')
export class ExampleController {
  constructor(private readonly users: UsersService) {}

  @Get('hello')
  async hello(@CurrentUser() user: AuthUser): Promise<{ greeting: string }> {
    const stored = await this.users.get(user.id);
    const lang = langOf(stored?.language ?? user.languageCode);
    return { greeting: GREETING[lang](user.firstName) };
  }
}
