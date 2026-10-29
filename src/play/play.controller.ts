import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PlayMode } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/auth.decorators';
import { PlayService } from './play.service';

class StartPlayDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  slug!: string;

  @IsEnum(PlayMode)
  mode!: PlayMode;
}

class EndPlayDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  score?: number;
}

@Controller('play')
export class PlayController {
  constructor(private readonly play: PlayService) {}

  @Post('start')
  start(@CurrentUser() user: AuthUser, @Body() dto: StartPlayDto) {
    return this.play.start(user.id, dto.slug, dto.mode);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } }) // app sends one every 15 s
  @Post(':id/heartbeat')
  @HttpCode(200)
  heartbeat(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.play.heartbeat(user.id, id);
  }

  @Post(':id/end')
  @HttpCode(200)
  end(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: EndPlayDto,
  ) {
    return this.play.end(user.id, id, dto.score);
  }
}
