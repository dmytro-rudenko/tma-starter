import { DynamicModule, Module } from '@nestjs/common';
import { Env } from './env';

export const ENV = Symbol('ENV');

@Module({})
export class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
