import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { MockPaymentProvider } from './mock.provider';
import { PAYMENT_PROVIDER } from './payment-provider';
import { TelebirrProvider } from './telebirr.provider';

@Global()
@Module({
  providers: [
    MockPaymentProvider,
    TelebirrProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [AppConfig, MockPaymentProvider, TelebirrProvider],
      useFactory: (
        config: AppConfig,
        mock: MockPaymentProvider,
        telebirr: TelebirrProvider,
      ) => (config.paymentProvider === 'telebirr' ? telebirr : mock),
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentProvidersModule {}
