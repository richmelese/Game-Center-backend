import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { AppConfig } from '../config/app-config.service';
import { normalizeEthioPhone } from '../common/phone';
import { verifyPassword } from '../common/password';
import { PrismaService } from '../prisma/prisma.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from '../payments/providers/payment-provider';

const OTP_TTL_SECONDS = 300;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sameHash = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Admin login lockout: after this many failures for one email, wait LOCK_MINUTES. */
const ADMIN_MAX_FAILURES = 5;
const ADMIN_LOCK_MINUTES = 15;
/** Used when the email is unknown so a wrong email and a wrong password take the same time. */
const DUMMY_HASH = 'scrypt$00000000000000000000000000000000$' + '0'.repeat(128);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly adminFailures = new Map<
    string,
    { count: number; until: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    @Inject(PAYMENT_PROVIDER) private readonly telebirr: PaymentProvider,
  ) {}

  private phoneOrThrow(phone: string) {
    const msisdn = normalizeEthioPhone(phone);
    if (!msisdn)
      throw new BadRequestException(
        'Enter a valid Ethio telecom number, e.g. 0911223344',
      );
    return msisdn;
  }

  async requestOtp(phone: string) {
    const msisdn = this.phoneOrThrow(phone);
    const last = await this.prisma.otpCode.findFirst({
      where: { phone: msisdn },
      orderBy: { createdAt: 'desc' },
    });
    if (
      last &&
      Date.now() - last.createdAt.getTime() < OTP_RESEND_SECONDS * 1000
    ) {
      throw new HttpException(
        'Please wait a minute before requesting a new code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.otpCode.create({
      data: {
        phone: msisdn,
        codeHash: sha256(`${msisdn}:${code}`),
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
      },
    });
    // Production: deliver through Ethio telecom's SMS gateway (not connected yet).
    // Development: the code is written to the server log (and echoed only if OTP_DEV_ECHO=true).
    if (!this.config.isProduction)
      this.logger.log(`OTP for ${msisdn}: ${code}`);
    return {
      sent: true,
      expiresInSeconds: OTP_TTL_SECONDS,
      ...(this.config.otpDevEcho ? { devCode: code } : {}),
    };
  }

  async verifyOtp(phone: string, code: string, name?: string) {
    const msisdn = this.phoneOrThrow(phone);
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone: msisdn, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.expiresAt < new Date())
      throw new UnauthorizedException('Code expired, request a new one');
    if (otp.attempts >= OTP_MAX_ATTEMPTS)
      throw new UnauthorizedException('Too many attempts, request a new code');
    if (!sameHash(otp.codeHash, sha256(`${msisdn}:${code}`))) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Incorrect code');
    }
    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
    const user = await this.prisma.user.upsert({
      where: { phone: msisdn },
      update: name ? { name } : {},
      create: { phone: msisdn, name },
    });
    return this.session(user);
  }

  /** Journey step 1: customer opens the Game Center from inside the telebirr SuperApp. */
  async telebirrLogin(authToken: string) {
    const id = await this.telebirr.authenticate(authToken);
    const msisdn = id.msisdn ? normalizeEthioPhone(id.msisdn) : null;
    const existing =
      (await this.prisma.user.findUnique({
        where: { telebirrOpenId: id.openId },
      })) ??
      (msisdn
        ? await this.prisma.user.findUnique({ where: { phone: msisdn } })
        : null);
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            telebirrOpenId: id.openId,
            phone: existing.phone ?? msisdn,
            name: existing.name ?? id.name,
          },
        })
      : await this.prisma.user.create({
          data: { telebirrOpenId: id.openId, phone: msisdn, name: id.name },
        });
    return this.session(user);
  }

  async adminLogin(email: string, password: string) {
    const key = email.toLowerCase();
    const lock = this.adminFailures.get(key);
    if (lock && lock.until > Date.now()) {
      throw new HttpException(
        `Too many failed attempts. Try again in ${Math.ceil((lock.until - Date.now()) / 60_000)} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.prisma.user.findUnique({ where: { email: key } });
    const isAdmin = user?.role === Role.ADMIN && !!user.passwordHash;
    // always run the password check so response time does not reveal which emails exist
    const passwordOk = await verifyPassword(
      password,
      isAdmin ? user.passwordHash! : DUMMY_HASH,
    );
    if (!user || !isAdmin || !passwordOk) {
      // start counting again only after a lock has expired (until = 0 means "not locked yet")
      const lockExpired = !!lock && lock.until > 0 && lock.until <= Date.now();
      const count = (lockExpired ? 0 : (lock?.count ?? 0)) + 1;
      this.adminFailures.set(key, {
        count,
        until:
          count >= ADMIN_MAX_FAILURES
            ? Date.now() + ADMIN_LOCK_MINUTES * 60_000
            : 0,
      });
      this.logger.warn(`Failed admin login for ${key} (${count})`);
      throw new UnauthorizedException('Invalid email or password');
    }
    this.adminFailures.delete(key);
    return this.session(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return this.publicUser(user);
  }

  private async session(user: User) {
    // admin sessions are short-lived (8h by default); customers use JWT_EXPIRES_IN
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role },
      user.role === Role.ADMIN
        ? { expiresIn: this.config.adminTokenTtl as `${number}h` }
        : {},
    );
    return { accessToken, user: this.publicUser(user) };
  }

  private publicUser(u: User) {
    return {
      id: u.id,
      phone: u.phone,
      name: u.name,
      email: u.email,
      role: u.role,
      coinBalance: u.coinBalance,
    };
  }
}
