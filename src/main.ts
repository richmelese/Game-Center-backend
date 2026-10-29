import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ADMIN_COOKIE, CUSTOMER_COOKIE } from './auth/auth.constants';
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
  app.use(cookieParser());
  app.use(helmet());
  if (!config.isProduction) {
    // swagger-ui needs inline scripts/styles; relax CSP for its path only
    app.use(
      '/api/docs',
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
          },
        },
      }),
    );
    const doc = new DocumentBuilder()
      .setTitle('teleGame API')
      .setDescription('Game Center backend for the telebirr SuperApp')
      .setVersion('1.0')
      .addCookieAuth(CUSTOMER_COOKIE, { type: 'apiKey', in: 'cookie', name: CUSTOMER_COOKIE })
      .addCookieAuth(ADMIN_COOKIE, { type: 'apiKey', in: 'cookie', name: ADMIN_COOKIE })
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  }
  app.enableCors({
    origin: config.frontendUrl,
    credentials: true, // the session cookie travels cross-origin (frontend/backend are separate ports/hosts)
    methods: ['GET', 'POST', 'PUT', 'PATCH'],
    allowedHeaders: ['Content-Type'],
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
    log.log(`API docs on http://localhost:${config.port}/api/docs`);
    const shortcuts = [
      config.payoutProvider === 'mock' && 'simulated payouts',
      config.otpDevEcho &&
        'login codes returned in the API response (OTP_DEV_ECHO)',
    ].filter(Boolean);
    if (shortcuts.length)
      log.warn(`DEVELOPMENT shortcuts enabled: ${shortcuts.join('; ')}`);
  }
}
void bootstrap();
