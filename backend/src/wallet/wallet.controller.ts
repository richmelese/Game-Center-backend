import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsInt, Max, Min } from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/auth.decorators';
import { WalletService } from './wallet.service';

class ConvertDto {
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  coins!: number;
}

@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.wallet.summary(user.id);
  }

  @Get('transactions')
  transactions(@CurrentUser() user: AuthUser) {
    return this.wallet.transactions(user.id);
  }

  @Get('redemptions')
  redemptions(@CurrentUser() user: AuthUser) {
    return this.wallet.redemptions(user.id);
  }

  @Post('convert')
  convert(@CurrentUser() user: AuthUser, @Body() dto: ConvertDto) {
    return this.wallet.convert(user.id, dto.coins);
  }
}
