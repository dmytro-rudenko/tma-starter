import { Injectable, Logger } from '@nestjs/common';

export type AdminUserCardLoader = (userId: number) => Promise<unknown>;

@Injectable()
export class AdminUserCardRegistry {
  private readonly logger = new Logger(AdminUserCardRegistry.name);
  private readonly loaders = new Map<string, AdminUserCardLoader>();

  register(key: string, loader: AdminUserCardLoader): void {
    if (this.loaders.has(key)) throw new Error(`AdminUserCardRegistry: duplicate key ${key}`);
    this.loaders.set(key, loader);
  }

  async collect(userId: number): Promise<Record<string, unknown>> {
    const entries = await Promise.all(
      [...this.loaders].map(async ([key, load]): Promise<[string, unknown]> => {
        try {
          return [key, await load(userId)];
        } catch (err) {
          this.logger.warn(`card ${key} failed: ${err instanceof Error ? err.message : String(err)}`);
          return [key, null];
        }
      }),
    );
    return Object.fromEntries(entries);
  }
}
