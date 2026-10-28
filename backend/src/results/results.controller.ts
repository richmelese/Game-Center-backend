import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Request } from 'express';
import { Public } from '../common/auth.decorators';
import { ResultsService } from './results.service';

class ReportResultDto {
  @Matches(/^[A-Za-z0-9_.:-]{1,100}$/, {
    message: 'resultId must be 1-100 characters: letters, digits, _ . : -',
  })
  resultId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  sessionId!: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  score!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  level?: number;

  @IsOptional()
  @IsBoolean()
  won?: boolean;
}

/**
 * Server-to-server endpoint for game suppliers (see docs/GAME-RESULTS-API.md).
 * Authenticated by the per-game HMAC signature, not by a customer login.
 */
@Controller('games/:slug/results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Public()
  @SkipThrottle()
  @Post()
  @HttpCode(200)
  report(
    @Param('slug') slug: string,
    @Headers('x-tg-timestamp') timestamp: string | undefined,
    @Headers('x-tg-signature') signature: string | undefined,
    @Req() req: RawBodyRequest<Request>,
    @Body() dto: ReportResultDto,
  ) {
    return this.results.report(
      slug,
      { timestamp, signature },
      req.rawBody,
      dto,
    );
  }
}
