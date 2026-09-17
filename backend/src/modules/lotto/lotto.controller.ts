import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../auth/interfaces/authenticated-request.interface';
import { LottoService } from './lotto.service';
import { GetLottoResultsDto } from './dto/get-lotto-results.dto';
import { GetLottoRoundsDto } from './dto/get-lotto-rounds.dto';
import { PlaceLottoTicketDto } from './dto/place-lotto-ticket.dto';
import { QueryMyLottoTicketsDto } from './dto/query-my-lotto-tickets.dto';

@ApiTags('lotto')
@Controller('lotto')
export class LottoController {
  constructor(private readonly lottoService: LottoService) {}

  @Get('rounds/active')
  @ApiOperation({ summary: 'Get active lotto round and runtime controls' })
  async getActiveRound(@Query() query: GetLottoRoundsDto) {
    return this.lottoService.getActiveRound(query.category);
  }

  @Get('rounds/:id')
  @ApiOperation({ summary: 'Get lotto round by id' })
  async getRoundById(@Param('id', ParseIntPipe) roundId: number) {
    return this.lottoService.getRoundById(roundId);
  }

  @Post('tickets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Purchase lotto ticket' })
  async placeTicket(
    @Request() req: AuthenticatedRequest,
    @Body() dto: PlaceLottoTicketDto,
  ) {
    const createdOrExistingTicket = await this.lottoService.purchaseTicket(
      req.user.id,
      dto.roundId,
      dto.amount,
      dto.selectedNumbers,
      dto.idempotencyKey,
    );

    return this.lottoService.getTicketById(
      req.user.id,
      createdOrExistingTicket.id,
    );
  }

  @Get('tickets/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get authenticated user lotto tickets' })
  async getMyTickets(
    @Request() req: AuthenticatedRequest,
    @Query() query: QueryMyLottoTicketsDto,
  ) {
    return this.lottoService.getMyTickets(req.user.id, query);
  }

  @Get('tickets/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get authenticated user lotto ticket by id' })
  async getTicketById(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) ticketId: number,
  ) {
    return this.lottoService.getTicketById(req.user.id, ticketId);
  }

  @Get('results/recent')
  @ApiOperation({ summary: 'Get recent lotto results' })
  async getRecentResults(@Query() query: GetLottoResultsDto) {
    return this.lottoService.getRecentResults(query);
  }

  // NOTE: declared BEFORE 'results/:roundId' — otherwise Nest would match
  // 'pending' against the ParseIntPipe param route and reject it with a 400.
  @Get('results/pending')
  @ApiOperation({
    summary:
      'Get the pre-computed result awaiting its 00:00 reveal (cutoff window only)',
  })
  async getPendingResult(@Query() query: GetLottoResultsDto) {
    return this.lottoService.getPendingResult(query.category);
  }

  @Get('results/:roundId')
  @ApiOperation({ summary: 'Get lotto result by round id' })
  async getResultByRoundId(@Param('roundId', ParseIntPipe) roundId: number) {
    return this.lottoService.getResultByRoundId(roundId);
  }
}
