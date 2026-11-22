import 'reflect-metadata';
import { createValidationPipe } from '@dmytro-rudenko/tma-nest-core';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { validateEnv } from './config/env';
import { createKnexConnection } from './database/knex';

async function bootstrap() {
  const env = validateEnv(process.env);
  const knex = createKnexConnection(env.DATABASE_URL);
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot({
      knex,
      botToken: env.BOT_TOKEN,
      apiRoot: env.BOT_API_ROOT,
      env: process.env,
    }),
  );
  // nginx reaches the dockerised API from the bridge gateway (a private address), so trust
  // loopback and private ranges for `req.ip` to be the client from X-Forwarded-For.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(env.PORT);
}

void bootstrap();
