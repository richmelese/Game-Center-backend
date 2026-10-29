import { Global, Module } from '@nestjs/common';
import { PAYMENT_PROVIDER } from './payment-provider';
import { TelebirrProvider } from './telebirr.provider';

@Global()
@Module({
  providers: [
    TelebirrProvider,
    { provide: PAYMENT_PROVIDER, useExisting: TelebirrProvider },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentProvidersModule {}
