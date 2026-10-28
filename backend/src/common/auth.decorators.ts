import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  role: Role;
}

/** The parts of the HTTP request the auth layer reads and writes. */
export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}

export const IS_PUBLIC = 'isPublic';
/** Route is reachable without a token (catalog browsing, payment webhooks...). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<AuthRequest>().user as AuthUser,
);
