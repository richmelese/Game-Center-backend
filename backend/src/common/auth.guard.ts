import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthRequest, IS_PUBLIC, ROLES } from './auth.decorators';

/**
 * Global guard: every route requires a valid JWT unless marked @Public().
 *
 * - Only HS256 tokens signed with JWT_SECRET are accepted (no "alg: none" / key confusion).
 * - The user is re-read from the database on every request, so a deleted account or a
 *   changed role takes effect immediately instead of when the token expires.
 * - @Public() routes are only the few that cannot carry a customer login (login itself,
 *   signed server-to-server callbacks, health); they never read a token.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets))
      return true;

    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Please log in');
    }

    let payload: { sub?: unknown };
    try {
      payload = await this.jwt.verifyAsync(header.slice(7), {
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Session expired, please log in again');
    }
    if (typeof payload.sub !== 'string' || !payload.sub) {
      throw new UnauthorizedException('Session expired, please log in again');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true },
    });
    if (!user)
      throw new UnauthorizedException('Session expired, please log in again');
    req.user = { id: user.id, role: user.role };

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException('You do not have access to this resource');
    }
    return true;
  }
}
