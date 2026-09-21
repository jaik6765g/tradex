import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

import { WalletsService } from './wallets.service';

/**
 * ============================================================
 * WALLETS CONTROLLER
 * ============================================================
 *
 * Read-only view of the wallets a user has LINKED (signature-verified)
 * to their account.
 *
 * Withdrawals are only ever paid to a linked wallet, so the withdrawal
 * screen reads this list to gate the form up-front instead of letting the
 * user submit an address the backend has to reject.
 */
@ApiTags('wallets')
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List the wallets linked to the authenticated user',
  })
  @ApiBearerAuth()
  async getMyWallets(@Request() req: AuthenticatedRequest) {
    const wallets = await this.walletsService.listByUser(req.user.id);

    return {
      success: true,
      data: wallets.map((wallet) => ({
        id: wallet.id,
        address: wallet.address,
        chainId: wallet.chainId,
        isPrimary: wallet.isPrimary,
      })),
    };
  }
}
