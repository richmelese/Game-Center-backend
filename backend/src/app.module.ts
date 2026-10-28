import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { Public } from './common/auth.decorators';
import { AuthGuard } from './common/auth.guard';
import { CommonModule } from './common/common.module';
import { EntitlementsService } from './entitlements/entitlements.service';
import { GamesController } from './games/games.controller';
import { GamesService } from './games/games.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { PaymentProvidersModule } from './payments/providers/providers.module';
import { PlayController } from './play/play.controller';
import { PlayService } from './play/play.service';
import { ResultsController } from './results/results.controller';
import { ResultsService } from './results/results.service';
import { SupportController } from './support/support.controller';
import { WalletController } from './wallet/wallet.controller';
import { WalletService } from './wallet/wallet.service';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { status: 'ok', service: 'telegame-backend' };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret || secret.length < 32)
          throw new Error('JWT_SECRET must be set (at least 32 characters)');
        return {
          secret,
          signOptions: {
            expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as `${number}d`,
          },
        };
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    CommonModule,
    PaymentProvidersModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    GamesController,
    PaymentsController,
    PlayController,
    WalletController,
    SupportController,
    ResultsController,
    AdminController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    AuthService,
    EntitlementsService,
    GamesService,
    PaymentsService,
    PlayService,
    WalletService,
    ResultsService,
    AdminService,
  ],
})
export class AppModule {}
