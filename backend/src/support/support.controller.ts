import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';

class CreateTicketDto {
  @IsString()
  @Length(3, 120)
  subject!: string;

  @IsString()
  @Length(5, 2000)
  message!: string;
}

/** First-level customer support and feedback collection (proposal section 4.4). */
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.prisma.supportTicket.create({
      data: { userId: user.id, subject: dto.subject, message: dto.message },
    });
  }

  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.prisma.supportTicket.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
