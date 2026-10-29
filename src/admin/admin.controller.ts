import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  CoinMode,
  OrderStatus,
  RedemptionStatus,
  Role,
  TicketStatus,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Length,
  Max,
  Min,
} from 'class-validator';
import { CurrentUser, Roles, type AuthUser } from '../common/auth.decorators';
import { startOfAddisDay } from '../common/time';
import { CoinSettingsService } from '../settings/coin-settings.service';
import { AdminService, Range } from './admin.service';

class UpdateGameDto {
  @IsOptional() @IsString() @Length(2, 80) title?: string;
  @IsOptional() @IsString() @Length(2, 40) category?: string;
  @IsOptional() @IsString() @Length(5, 500) description?: string;
  @IsOptional() @IsString() @Length(2, 40) targetAudience?: string;
  /** https URL, or a path on GAMES_BASE_URL such as /games/puzzle/2048/index.html */
  @IsOptional()
  @Matches(/^(https:\/\/[^\s"'<>]+|\/[\w\-./]+)$/, {
    message: 'gameUrl must be an https URL or a path starting with /',
  })
  gameUrl?: string;
  @IsOptional() @IsHexColor() themeColor?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
  @IsOptional() @IsEnum(CoinMode) coinMode?: CoinMode;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) pointsPerCoin?: number;
}

class UpdatePlanDto {
  @IsOptional() @IsInt() @Min(100) @Max(1_000_000) priceCents?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class PayRedemptionDto {
  @IsString() @Length(3, 80) payoutRef!: string;
}

class RejectRedemptionDto {
  @IsString() @Length(3, 300) note!: string;
}

/** Admin → Coin settings. All fields are required so the whole rule set is saved together. */
class CoinSettingsDto {
  /** coins paid for every completed interval of play */
  @IsInt() @Min(1) @Max(10_000) coinsPerInterval!: number;
  /** interval length in minutes (1 = per minute) */
  @IsInt() @Min(1) @Max(1440) intervalMinutes!: number;
  @IsInt() @Min(1) @Max(1_000_000) maxPerSession!: number;
  @IsInt() @Min(1) @Max(1_000_000) maxPerDay!: number;
  /** this many coins = 1 ETB */
  @IsInt() @Min(1) @Max(1_000_000) coinsPerEtb!: number;
  @IsInt() @Min(1) @Max(1_000_000) minRedeem!: number;
}

class UpdateTicketDto {
  @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;
  @IsOptional() @IsString() @Length(1, 2000) response?: string;
}

/** Date range from ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, Addis Ababa days). Defaults to the last 30 days. */
function parseRange(from?: string, to?: string): Range {
  const day = (s: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
      throw new BadRequestException('Dates must be YYYY-MM-DD');
    return new Date(`${s}T00:00:00+03:00`);
  };
  const end = to
    ? new Date(day(to).getTime() + 86_400_000)
    : new Date(startOfAddisDay().getTime() + 86_400_000);
  const start = from ? day(from) : new Date(end.getTime() - 30 * 86_400_000);
  if (start >= end) throw new BadRequestException('"from" must be before "to"');
  return { from: start, to: end };
}

@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly coinSettings: CoinSettingsService,
  ) {}

  @Get('settings/coins')
  getCoinSettings() {
    return this.coinSettings.get();
  }

  @Put('settings/coins')
  updateCoinSettings(
    @Body() dto: CoinSettingsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.coinSettings.update(dto, user.id);
  }

  @Get('summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.summary(parseRange(from, to));
  }

  @Get('revenue/daily')
  daily(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.daily(parseRange(from, to));
  }

  @Get('revenue.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="telegame-revenue.csv"')
  csv(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.revenueCsv(parseRange(from, to));
  }

  @Get('orders')
  orders(@Query('status') status?: OrderStatus, @Query('page') page?: string) {
    if (status && !Object.values(OrderStatus).includes(status))
      throw new BadRequestException('Invalid status');
    return this.admin.orders(status, Math.max(1, Number(page) || 1));
  }

  @Get('games')
  games() {
    return this.admin.games();
  }

  @Post('games/:id/result-secret')
  rotateResultSecret(@Param('id') id: string) {
    return this.admin.rotateResultSecret(id);
  }

  @Get('results')
  results(@Query('gameId') gameId?: string) {
    return this.admin.results(gameId || undefined);
  }

  @Patch('games/:id')
  updateGame(@Param('id') id: string, @Body() dto: UpdateGameDto) {
    return this.admin.updateGame(id, dto);
  }

  @Patch('plans/:id')
  updatePlan(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.admin.updatePlan(id, dto);
  }

  @Get('redemptions')
  redemptions(@Query('status') status?: RedemptionStatus) {
    if (status && !Object.values(RedemptionStatus).includes(status))
      throw new BadRequestException('Invalid status');
    return this.admin.redemptions(status);
  }

  @Post('redemptions/:id/pay')
  pay(@Param('id') id: string, @Body() dto: PayRedemptionDto) {
    return this.admin.markRedemptionPaid(id, dto.payoutRef);
  }

  @Post('redemptions/:id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectRedemptionDto) {
    return this.admin.rejectRedemption(id, dto.note);
  }

  @Get('tickets')
  tickets(@Query('status') status?: TicketStatus) {
    if (status && !Object.values(TicketStatus).includes(status))
      throw new BadRequestException('Invalid status');
    return this.admin.tickets(status);
  }

  @Patch('tickets/:id')
  updateTicket(@Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return this.admin.updateTicket(id, dto);
  }
}
