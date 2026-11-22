import { Body, Controller, Get, HttpStatus, Patch } from '@nestjs/common';
import { AdminRightsService, AdminSource } from '../admin-rights/admin-rights.service';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { apiError } from '../common/api-error';
import { TmaLanguage, TmaTheme, TmaUser, UserPrefs, UsersService } from '../users/users.service';

export interface MeResponse {
  id: number;
  firstName: string;
  username: string | null;
  language: TmaLanguage | null;
  theme: TmaTheme;
  isAdmin: boolean;
  adminSource: AdminSource | null;
}

const LANGUAGES: readonly unknown[] = ['uk', 'en', null];
const THEMES: readonly unknown[] = ['system', 'light', 'dark'];

@Controller('api/me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly rights: AdminRightsService,
  ) {}

  @Get()
  async get(@CurrentUser() auth: AuthUser): Promise<MeResponse> {
    const user = await this.users.get(auth.id);
    if (!user) throw apiError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND');
    return this.view(user);
  }

  @Patch()
  async update(@CurrentUser() auth: AuthUser, @Body() body: unknown): Promise<MeResponse> {
    const { language, theme } = (body ?? {}) as { language?: unknown; theme?: unknown };
    if (language !== undefined && !LANGUAGES.includes(language)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'language must be uk, en or null');
    }
    if (theme !== undefined && !THEMES.includes(theme)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'theme must be system, light or dark');
    }
    const prefs: UserPrefs = { language: language as UserPrefs['language'], theme: theme as UserPrefs['theme'] };
    return this.view(await this.users.updatePrefs(auth.id, prefs));
  }

  private view(u: TmaUser): MeResponse {
    const adminSource = this.rights.sourceOf(u.id, u.adminGrantedAt);
    return {
      id: u.id,
      firstName: u.firstName,
      username: u.username,
      language: u.language,
      theme: u.theme,
      isAdmin: adminSource !== null,
      adminSource,
    };
  }
}
