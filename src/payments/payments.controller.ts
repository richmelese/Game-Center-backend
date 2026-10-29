import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, Public, type AuthUser } from '../common/auth.decorators';
import { PaymentsService } from './payments.service';

class CheckoutDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  planId!: string;

  /** 'inApp' when opened from inside the telebirr SuperApp; defaults to the web H5 checkout. */
  @IsOptional()
  @IsIn(['web', 'inApp'])
  mode?: 'web' | 'inApp';
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Step 3: start the purchase/subscription flow; the client redirects to checkoutUrl (telebirr). */
  @Post('checkout')
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.payments.checkout(user.id, dto.planId, dto.mode ?? 'web');
  }

  /** Step 4: telebirr notify_url callback (signature-verified). */
  @Public()
  @SkipThrottle()
  @Post('telebirr/notify')
  @HttpCode(200)
  notify(@Body() body: Record<string, unknown>) {
    return this.payments.handleProviderNotification(body);
  }

  @Get('orders')
  myOrders(@CurrentUser() user: AuthUser) {
    return this.payments.myOrders(user.id);
  }

  @Get('orders/:merchOrderId')
  order(@CurrentUser() user: AuthUser, @Param('merchOrderId') id: string) {
    return this.payments.getOrder(user.id, id);
  }
}
