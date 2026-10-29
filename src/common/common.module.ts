import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { CoinSettingsService } from '../settings/coin-settings.service';

@Global()
@Module({
  providers: [PrismaService, AppConfig, CoinSettingsService],
  exports: [PrismaService, AppConfig, CoinSettingsService],
})
export class CommonModule {}
