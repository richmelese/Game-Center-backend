import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/auth.decorators';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { GamesService } from './games.service';

@Controller()
export class GamesController {
  constructor(
    private readonly games: GamesService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Get('games')
  list(@Query('category') category?: string) {
    return this.games.list(category || undefined);
  }

  @Get('games/:slug')
  detail(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    return this.games.detail(slug, user.id);
  }

  @Get('me/subscriptions')
  mySubscriptions(@CurrentUser() user: AuthUser) {
    return this.entitlements.listMine(user.id);
  }
}
