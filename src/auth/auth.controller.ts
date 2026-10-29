import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public, type AuthUser } from '../common/auth.decorators';
import { msFromDuration } from '../common/time';
import { AppConfig } from '../config/app-config.service';
import { ADMIN_COOKIE, CUSTOMER_COOKIE } from './auth.constants';
import {
  AdminLoginDto,
  RequestOtpDto,
  TelebirrLoginDto,
  VerifyOtpDto,
} from './auth.dto';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  /** Sets the session as an httpOnly cookie instead of handing the JWT to frontend JS. */
  private setSessionCookie(
    res: Response,
    name: typeof CUSTOMER_COOKIE | typeof ADMIN_COOKIE,
    accessToken: string,
    ttl: string,
  ) {
    res.cookie(name, accessToken, {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      path: '/api',
      maxAge: msFromDuration(ttl),
    });
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, user } = await this.auth.verifyOtp(
      dto.phone,
      dto.code,
      dto.name,
    );
    this.setSessionCookie(
      res,
      CUSTOMER_COOKIE,
      accessToken,
      this.config.jwtExpiresIn,
    );
    return { user };
  }

  @Public()
  @Post('telebirr')
  @HttpCode(200)
  async telebirr(
    @Body() dto: TelebirrLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, user } = await this.auth.telebirrLogin(dto.authToken);
    this.setSessionCookie(
      res,
      CUSTOMER_COOKIE,
      accessToken,
      this.config.jwtExpiresIn,
    );
    return { user };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('admin/login')
  @HttpCode(200)
  async adminLogin(
    @Body() dto: AdminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, user } = await this.auth.adminLogin(
      dto.email,
      dto.password,
    );
    this.setSessionCookie(
      res,
      ADMIN_COOKIE,
      accessToken,
      this.config.adminTokenTtl,
    );
    return { user };
  }

  /** Clears both session cookies; harmless no-op for whichever one wasn't set. */
  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(CUSTOMER_COOKIE, { path: '/api' });
    res.clearCookie(ADMIN_COOKIE, { path: '/api' });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
