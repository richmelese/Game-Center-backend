import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config.service';

async function bootstrap() {
  // rawBody: game result signatures are computed over the exact bytes received
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(AppConfig);
  const log = new Logger('Bootstrap');
  config.assertProductionSafe();

  // behind a load balancer / reverse proxy, use the real client IP for rate limits
  if (config.trustProxyHops > 0) app.set('trust proxy', config.trustProxyHops);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '50kb' });
  app.use(helmet());
  app.enableCors({
    origin: config.frontendUrl,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  await app.listen(config.port);
  log.log(`teleGame API on http://localhost:${config.port}/api`);
  log.log(
    `payments: ${config.paymentProvider}, payouts: ${config.payoutProvider}`,
  );
  if (!config.isProduction) {
    const shortcuts = [
      config.paymentProvider === 'mock' && 'simulated telebirr payments',
      config.payoutProvider === 'mock' && 'simulated payouts',
      config.otpDevEcho &&
        'login codes returned in the API response (OTP_DEV_ECHO)',
      config.mockTelebirrSso && 'mock telebirr sign-in (MOCK_TELEBIRR_SSO)',
    ].filter(Boolean);
    if (shortcuts.length)
      log.warn(`DEVELOPMENT shortcuts enabled: ${shortcuts.join('; ')}`);
  }
}
void bootstrap();
