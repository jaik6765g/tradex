// src/blockchain/blockchain.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BscWatcherService } from './bsc/bsc-watcher.service';
import { BlockchainService } from './blockchain.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'deposit-detection',
    }),
  ],
  providers: [BscWatcherService, BlockchainService],
  exports: [BlockchainService],
})
export class BlockchainModule {}
