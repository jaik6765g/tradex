import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health() {
    return {
      success: true,
      project: 'TradeX Backend',
      version: '1.0.0',
      status: 'ONLINE',
      timestamp: new Date().toISOString(),
    };
  }
}
