import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

import { CompleteBatchWithdrawalsDto } from './dto/complete-batch-withdrawals.dto';
import { CompleteWithdrawalDto } from './dto/complete-withdrawal.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { WithdrawalStatus } from './entities/withdrawal.entity';
import { WithdrawalsService } from './withdrawals.service';

/**
 * ============================================================
 * WITHDRAWALS CONTROLLER
 * ============================================================
 *
 * Final withdrawal architecture:
 *
 * USER
 *   ↓
 * REQUESTED
 *   ↓
 * RISK_CHECKING
 *   ↓
 * PENDING_ADMIN_APPROVAL
 *
 * ADMIN
 *   ↓
 * CONNECT METAMASK
 *   ↓
 * APPROVE
 *   ↓
 * APPROVED
 *
 * ADMIN WALLET / METAMASK  (signs + broadcasts the vault payout)
 *   ↓
 * WithdrawalVault.withdraw([verifiedUserWallet], [approvedAmount])
 *   ↓
 * txHash
 *
 * BACKEND
 *   ↓
 * /complete
 *   ↓
 * verifyWithdrawalVaultTransfer()
 *   ↓
 * COMPLETED
 *
 * IMPORTANT:
 *
 * Backend never receives an admin private key.
 * Backend never broadcasts the admin payout transaction.
 * Backend never automatically refunds TDX after payout approval.
 */
@ApiTags('withdrawals')
@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  // ============================================================
  // USER ENDPOINTS
  // ============================================================

  /**
   * ------------------------------------------------------------
   * CREATE WITHDRAWAL
   * ------------------------------------------------------------
   *
   * User submits a withdrawal request.
   *
   * The authenticated user ID is always authoritative.
   * Client supplied userId is only accepted when it matches
   * the authenticated identity.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Request a withdrawal',
  })
  @ApiBearerAuth()
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateWithdrawalDto,
  ) {
    // ----------------------------------------------------------
    // NEVER TRUST CLIENT USER ID
    // ----------------------------------------------------------

    if (dto.userId && dto.userId !== req.user.id) {
      throw new BadRequestException('userId does not match authenticated user');
    }

    // ----------------------------------------------------------
    // CREATE WITHDRAWAL
    // ----------------------------------------------------------

    const result = await this.withdrawalsService.createWithdrawal(
      req.user.id,
      dto.walletAddress,
      dto.chainId,
      dto.tokenAddress,
      dto.tdxAmount,
    );

    return {
      success: true,
      data: result,
      message: 'Withdrawal request submitted for admin approval',
    };
  }

  @Get('limits')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get deposit/withdrawal limits for the authenticated user',
  })
  @ApiBearerAuth()
  async getLimits(@Request() req: AuthenticatedRequest) {
    const data = await this.withdrawalsService.getUserLimits(req.user.id);

    return {
      success: true,
      data,
    };
  }

  /**
   * ------------------------------------------------------------
   * USER WITHDRAWAL HISTORY
   * ------------------------------------------------------------
   */
  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get user withdrawals',
  })
  @ApiBearerAuth()
  async getUserWithdrawals(@Request() req: AuthenticatedRequest) {
    const withdrawals = await this.withdrawalsService.getUserWithdrawals(
      req.user.id,
    );

    return {
      success: true,
      data: withdrawals,
    };
  }

  /**
   * ------------------------------------------------------------
   * USER SINGLE WITHDRAWAL
   * ------------------------------------------------------------
   *
   * User can only access their own withdrawal.
   */
  @Get('my/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get withdrawal by ID',
  })
  @ApiBearerAuth()
  async getWithdrawal(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const withdrawal = await this.withdrawalsService.getUserWithdrawalById(
      req.user.id,
      id,
    );

    return {
      success: true,
      data: withdrawal,
    };
  }

  // ============================================================
  // ADMIN ENDPOINTS
  // ============================================================

  /**
   * ------------------------------------------------------------
   * PENDING WITHDRAWALS
   * ------------------------------------------------------------
   *
   * Includes:
   *
   * - PENDING_ADMIN_APPROVAL
   * - APPROVED
   * - HOLD
   * - legacy processing states
   *
   * This allows admin dashboard to see withdrawals requiring
   * action as well as approved payouts waiting for MetaMask /
   * blockchain verification.
   */
  @Get('admin/pending')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Get pending withdrawals for admin review and payout',
  })
  @ApiBearerAuth()
  async getPendingWithdrawals() {
    const withdrawals = await this.withdrawalsService.getPendingWithdrawals();

    return {
      success: true,
      data: withdrawals,
    };
  }

  /**
   * ------------------------------------------------------------
   * ALL WITHDRAWALS
   * ------------------------------------------------------------
   */
  @Get('admin/all')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Get all withdrawals with filters (Admin)',
  })
  @ApiBearerAuth()
  async getAllWithdrawals(
    @Query(
      'limit',
      new ParseIntPipe({
        optional: true,
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
      }),
    )
    limit?: number,

    @Query(
      'offset',
      new ParseIntPipe({
        optional: true,
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
      }),
    )
    offset?: number,

    @Query('status')
    status?: string,

    @Query('search')
    search?: string,
  ) {
    /**
     * Service performs the actual query and pagination.
     *
     * Status is cast here because the existing service contract
     * accepts WithdrawalStatus.
     */
    const result = await this.withdrawalsService.getAllWithdrawals(
      limit,
      offset,
      status as WithdrawalStatus,
      search,
    );

    return {
      success: true,
      data: result.data,
      total: result.total,
    };
  }

  /**
   * ------------------------------------------------------------
   * ADMIN STATISTICS
   * ------------------------------------------------------------
   */
  @Get('admin/statistics')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Get withdrawal statistics (Admin)',
  })
  @ApiBearerAuth()
  async getStatistics() {
    const statistics = await this.withdrawalsService.getWithdrawalStatistics();

    return {
      success: true,
      data: statistics,
    };
  }

  // ============================================================
  // ADMIN: APPROVE
  // ============================================================

  /**
   * ------------------------------------------------------------
   * APPROVE WITHDRAWAL
   * ------------------------------------------------------------
   *
   * This endpoint DOES NOT send USDT.
   *
   * Admin frontend sends:
   *
   * {
   *   payoutWalletAddress: "0x...",
   *   note?: "..."
   * }
   *
   * Backend:
   *
   * PENDING_ADMIN_APPROVAL
   *        ↓
   * APPROVED
   *
   * Then frontend uses MetaMask to perform:
   *
   * USDT.transfer(
   *   withdrawal.walletAddress,
   *   withdrawal.usdtAmount
   * )
   *
   * After MetaMask returns txHash, frontend calls:
   *
   * PATCH /withdrawals/:id/complete
   */
  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Approve withdrawal for MetaMask USDT payout (Admin)',
  })
  @ApiBearerAuth()
  async approve(
    @Request() req: AuthenticatedRequest,

    @Param('id')
    id: string,

    @Body()
    body: {
      note?: string;
      payoutWalletAddress: string;
    },
  ) {
    // ----------------------------------------------------------
    // PAYOUT WALLET REQUIRED
    // ----------------------------------------------------------

    const payoutWalletAddress = body?.payoutWalletAddress?.trim();

    if (!payoutWalletAddress) {
      throw new BadRequestException('payoutWalletAddress is required');
    }

    // ----------------------------------------------------------
    // APPROVE
    // ----------------------------------------------------------

    const result = await this.withdrawalsService.approveWithdrawal(
      id,
      req.user.id,
      payoutWalletAddress,
      body?.note,
    );

    return {
      success: true,
      data: result,

      message:
        'Withdrawal approved. Sign the USDT payout transaction with the connected admin wallet.',
    };
  }

  // ============================================================
  // ADMIN: REJECT
  // ============================================================

  /**
   * ------------------------------------------------------------
   * REJECT WITHDRAWAL
   * ------------------------------------------------------------
   *
   * Explicit admin rejection is the normal TDX refund path.
   *
   * Only withdrawals that have NOT entered the payout lifecycle
   * can have their TDX reserve released.
   *
   * If:
   *
   * - payoutAttempted === true
   * - txHash exists
   * - APPROVED / PROCESSING / SENT
   *
   * the service will refuse automatic refund and require
   * reconciliation.
   */
  @Patch(':id/reject')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Reject withdrawal and release TDX reserve (Admin)',
  })
  @ApiBearerAuth()
  async reject(
    @Request() req: AuthenticatedRequest,

    @Param('id')
    id: string,

    @Body('reason')
    reason: string,
  ) {
    const normalizedReason = reason?.trim() || 'Rejected by admin';

    const result = await this.withdrawalsService.rejectWithdrawal(
      id,
      normalizedReason,
      req.user.id,
    );

    return {
      success: true,
      data: result,

      message: 'Withdrawal rejected and TDX reserve released',
    };
  }

  // ============================================================
  // ADMIN: PREPARE METAMASK PAYOUT
  // ============================================================

  /**
   * ------------------------------------------------------------
   * PROCESS / PREPARE
   * ------------------------------------------------------------
   *
   * IMPORTANT:
   *
   * This endpoint does NOT broadcast a blockchain transaction.
   *
   * It simply validates that the withdrawal is APPROVED and
   * returns the current payout state.
   *
   * The actual USDT transfer happens in the admin browser through
   * MetaMask.
   */
  @Patch(':id/process')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Prepare approved withdrawal for MetaMask payout (Admin)',
  })
  @ApiBearerAuth()
  async process(
    @Param('id')
    id: string,
  ) {
    const result = await this.withdrawalsService.startProcessing(id);

    return {
      success: true,
      data: result,

      message: 'Withdrawal is ready for MetaMask blockchain payout',
    };
  }

  // ============================================================
  // ADMIN: COMPLETE / VERIFY
  // ============================================================

  /**
   * ------------------------------------------------------------
   * COMPLETE WITHDRAWAL
   * ------------------------------------------------------------
   *
   * Admin frontend calls this after MetaMask successfully
   * broadcasts the USDT transfer.
   *
   * Backend DOES NOT trust the frontend's claim.
   *
   * Backend independently verifies:
   *
   * - chain
   * - USDT contract
   * - sender
   * - recipient
   * - exact USDT amount
   * - transaction receipt
   * - receipt success
   * - confirmations
   *
   * Only then:
   *
   * locked TDX -> consumed
   * withdrawal -> COMPLETED
   */
  @Patch(':id/complete')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Verify MetaMask USDT payout and complete withdrawal (Admin)',
  })
  @ApiBearerAuth()
  async complete(
    @Param('id')
    id: string,

    @Body()
    body: CompleteWithdrawalDto,
  ) {
    const normalizedTxHash = body?.txHash?.trim();

    if (!normalizedTxHash) {
      throw new BadRequestException('txHash is required');
    }

    if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedTxHash)) {
      throw new BadRequestException(
        'txHash must be a valid 0x-prefixed 32-byte hash',
      );
    }

    const result = await this.withdrawalsService.completeWithdrawal(
      id,
      normalizedTxHash,
    );

    return {
      success: true,
      data: result,

      message:
        'Blockchain payout verified and withdrawal completed successfully',
    };
  }

  // ============================================================
  // ADMIN: BATCH COMPLETE / VERIFY
  // ============================================================

  /**
   * ------------------------------------------------------------
   * COMPLETE BATCH WITHDRAWALS
   * ------------------------------------------------------------
   *
   * Admin frontend calls this after ONE MetaMask-signed
   * WithdrawalVault.withdraw(recipients[], amounts[]) batch
   * transaction has been broadcast and confirmed.
   *
   * ONE txHash + MULTIPLE withdrawal IDs.
   *
   * Backend DOES NOT trust the frontend's recipient/amount claims.
   *
   * Backend independently verifies the single transaction and
   * matches EVERY requested withdrawal to a unique USDT Transfer
   * event (Transfer.from === configured WithdrawalVault,
   * Transfer.to === verified wallet, Transfer.value === approved
   * amount), then atomically completes ALL withdrawals.
   *
   * If ANY withdrawal fails verification, the ENTIRE batch is
   * rejected - no withdrawal is marked COMPLETED.
   */
  @Post('batch/complete')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary:
      'Verify one batch WithdrawalVault payout and complete multiple withdrawals (Admin)',
  })
  @ApiBearerAuth()
  async completeBatch(
    @Body()
    body: CompleteBatchWithdrawalsDto,
  ) {
    const normalizedTxHash = body?.txHash?.trim();

    if (!normalizedTxHash) {
      throw new BadRequestException('txHash is required');
    }

    if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedTxHash)) {
      throw new BadRequestException(
        'txHash must be a valid 0x-prefixed 32-byte hash',
      );
    }

    const result = await this.withdrawalsService.batchCompleteWithdrawals(
      body.withdrawalIds,
      normalizedTxHash,
    );

    return {
      success: true,
      data: result,

      message:
        'Batch blockchain payout verified and all withdrawals completed successfully',
    };
  }

  // ============================================================
  // ADMIN: FAIL PRE-PAYOUT
  // ============================================================

  /**
   * ------------------------------------------------------------
   * FAIL
   * ------------------------------------------------------------
   *
   * This route is ONLY for a withdrawal where no blockchain
   * payout has been attempted.
   *
   * If payoutAttempted/txHash exists, the service refuses the
   * operation and requires blockchain reconciliation.
   */
  @Patch(':id/fail')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Mark pre-payout withdrawal as failed (Admin)',
  })
  @ApiBearerAuth()
  async fail(
    @Param('id')
    id: string,

    @Body('reason')
    reason: string,
  ) {
    const normalizedReason = reason?.trim() || 'Processing failed';

    const result = await this.withdrawalsService.failWithdrawal(
      id,
      normalizedReason,
    );

    return {
      success: true,
      data: result,

      message: 'Withdrawal marked as failed',
    };
  }

  // ============================================================
  // ADMIN: RELEASE HOLD
  // ============================================================

  /**
   * ------------------------------------------------------------
   * RELEASE HOLD
   * ------------------------------------------------------------
   *
   * HOLD is for risk/manual review.
   *
   * Releasing HOLD does NOT perform any blockchain transaction.
   *
   * It simply moves:
   *
   * HOLD
   *   ↓
   * PENDING_ADMIN_APPROVAL
   *
   * No vault liquidity check is performed here.
   */
  @Patch(':id/release-hold')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Release withdrawal from risk/manual-review hold (Admin)',
  })
  @ApiBearerAuth()
  async releaseHold(
    @Param('id')
    id: string,
  ) {
    const result = await this.withdrawalsService.releaseHold(id);

    return {
      success: true,
      data: result,

      message: 'Withdrawal released from hold and returned to admin approval',
    };
  }

  // ============================================================
  // ADMIN: REVALIDATE STUCK APPROVED PAYOUT
  // ============================================================

  /**
   * ------------------------------------------------------------
   * REVALIDATE PAYOUT
   * ------------------------------------------------------------
   *
   * Safe recovery path for stuck APPROVED withdrawals where no
   * payout evidence exists.
   *
   * Allowed only when:
   *
   * - status === APPROVED
   * - txHash is null/empty
   * - payoutAttempted === false
   *
   * Transition:
   *
   * APPROVED
   *   ↓
   * PENDING_ADMIN_APPROVAL
   *
   * IMPORTANT:
   * - No TDX refund
   * - No reserve release
   * - No blockchain transfer
   * - No queue usage
   */
  @Patch(':id/revalidate-payout')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary:
      'Revalidate stuck APPROVED withdrawal with no payout evidence and return to admin approval (Admin)',
  })
  @ApiBearerAuth()
  async revalidatePayout(
    @Request() req: AuthenticatedRequest,

    @Param('id')
    id: string,
  ) {
    const result = await this.withdrawalsService.revalidateApprovedPayout(
      id,
      req.user.id,
    );

    return {
      success: true,
      data: result,

      message:
        'Withdrawal payout revalidated and returned to pending admin approval without releasing reserve',
    };
  }
}
