import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CurrentUser, Public, type AuthUser } from '../common/auth.decorators';
import { PaymentsService } from './payments.service';

class CheckoutDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  planId!: string;
}

class MockCompleteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  merchOrderId!: string;

  @IsBoolean()
  success!: boolean;
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Step 3: start the purchase/subscription flow; the client redirects to checkoutUrl (telebirr). */
  @Post('checkout')
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.payments.checkout(user.id, dto.planId);
  }

  /** Step 4: telebirr notify_url callback (signature-verified). */
  @Public()
  @SkipThrottle()
  @Post('telebirr/notify')
  @HttpCode(200)
  notify(@Body() body: Record<string, unknown>) {
    return this.payments.handleProviderNotification(body);
  }

  @Post('mock/complete')
  @HttpCode(200)
  mockComplete(@CurrentUser() user: AuthUser, @Body() dto: MockCompleteDto) {
    return this.payments.completeMock(user.id, dto.merchOrderId, dto.success);
  }

  @Get('orders')
  myOrders(@CurrentUser() user: AuthUser) {
    return this.payments.myOrders(user.id);
  }

  @Get('orders/:merchOrderId')
  order(@CurrentUser() user: AuthUser, @Param('merchOrderId') id: string) {
    return this.payments.getOrder(user.id, id);
  }

  @Get('orders/:merchOrderId/checkout-info')
  checkoutInfo(
    @CurrentUser() user: AuthUser,
    @Param('merchOrderId') id: string,
  ) {
    return this.payments.pendingCheckoutInfo(user.id, id);
  }
}
