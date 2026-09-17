// backend/src/modules/period-sync/period-sync.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PeriodSyncService, PeriodSyncSnapshot } from './period-sync.service';

@ApiTags('wingo-period')
@Controller('wingo')
export class PeriodSyncController {
  constructor(private readonly periodSyncService: PeriodSyncService) {}

  @Get('current-period')
  @ApiOperation({
    summary:
      'Authoritative current WinGo 30-second period + synchronized server time',
  })
  getCurrentPeriod(): PeriodSyncSnapshot | { syncStatus: 'NEVER_SYNCED' } {
    const snapshot = this.periodSyncService.getSnapshot();
    if (!snapshot) {
      return { syncStatus: 'NEVER_SYNCED' };
    }
    return snapshot;
  }
}
