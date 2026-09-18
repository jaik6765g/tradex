import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

import { WageringService } from './wagering.service';

@ApiTags('wagering')
@Controller('wagering')
@UseGuards(JwtAuthGuard)
export class WageringController {
  constructor(private readonly wageringService: WageringService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user wagering summary' })
  @ApiBearerAuth()
  async getMySummary(@Request() req: AuthenticatedRequest) {
    return this.wageringService.getUserSummaryDto(req.user.id);
  }

  @Get('me/notifications')
  @ApiOperation({ summary: 'Get wagering notifications for the user' })
  @ApiBearerAuth()
  async getNotifications(@Request() req: AuthenticatedRequest) {
    return this.wageringService.listUserNotifications(req.user.id);
  }

  @Post('me/notifications/read')
  @ApiOperation({ summary: 'Mark all wagering notifications as read' })
  @ApiBearerAuth()
  async markRead(@Request() req: AuthenticatedRequest) {
    await this.wageringService.markNotificationsRead(req.user.id);
    return { ok: true };
  }
}