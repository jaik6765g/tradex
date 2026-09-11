import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { UsersService } from './users.service';

import { AdminListReferralsQueryDto } from './dto/admin-list-referrals-query.dto';
import { AdminListUsersQueryDto } from './dto/admin-list-users-query.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { AdminGuard } from '../auth/guards/admin.guard';

import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

// ============================================================
// USERS CONTROLLER
// ============================================================

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ==========================================================
  // USER - MY REFERRAL DASHBOARD
  // ==========================================================

  /**
   * Returns the authenticated user's complete referral dashboard.
   *
   * Includes:
   * - Own referral code
   * - Own referral link
   * - Total network users
   * - Total active users
   * - Total referral earnings
   * - L1 → L6 referral network
   * - Per-level percentage
   * - Per-user trade volume
   * - Per-user referral earnings
   */
  @Get('referral/me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get authenticated user referral dashboard',
  })
  async getMyReferralDashboard(
    @Request()
    req: AuthenticatedRequest,
  ) {
    return this.usersService.getMyReferralDashboard(req.user.id);
  }

  @Get('referral/performance/me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get authenticated user referral performance summary',
  })
  async getMyReferralPerformance(
    @Request()
    req: AuthenticatedRequest,
  ) {
    return this.usersService.getMyReferralPerformance(req.user.id);
  }

  // ==========================================================
  // ADMIN - USERS
  // ==========================================================

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Get all users (admin)',
  })
  async getAdminUsers(
    @Query()
    query: AdminListUsersQueryDto,
  ) {
    return this.usersService.getAdminUsersList(query);
  }

  @Get('admin/metrics')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Get users dashboard metrics (admin)',
  })
  async getAdminUserMetrics() {
    return this.usersService.getAdminUserMetrics();
  }

  // ==========================================================
  // ADMIN - REFERRALS
  // ==========================================================

  /**
   * Admin-only referral users list.
   *
   * This endpoint is intentionally kept separate
   * from the user referral dashboard.
   */
  @Get('admin/referrals')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Get referral users (admin)',
  })
  async getAdminReferrals(
    @Query()
    query: AdminListReferralsQueryDto,
  ) {
    return this.usersService.getAdminReferralsList(query);
  }

  @Get('admin/users/:userId/details')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Get admin user details with balance, deposits, withdrawals, trades, and referral info',
  })
  async getAdminUserDetails(
    @Param('userId') userId: string,
  ) {
    return this.usersService.getAdminUserDetails(userId);
  }

  @Get('admin/referrals/:userId/details')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Get admin referral details with L1-L6 breakdown, earnings, deposits, withdrawals',
  })
  async getAdminReferralDetails(
    @Param('userId') userId: string,
  ) {
    return this.usersService.getAdminReferralDetails(userId);
  }
}
