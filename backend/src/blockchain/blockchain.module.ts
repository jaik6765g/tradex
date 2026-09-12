// src/blockchain/blockchain.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BscWatcherService } from './bsc/bsc-watcher.service';
import { BscRpcService } from './bsc/bsc-rpc.service';
import { BlockchainService } from './blockchain.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'deposit-detection',
    }),
  ],
  providers: [BscWatcherService, BscRpcService, BlockchainService],
  exports: [BlockchainService, BscRpcService],
})
export class BlockchainModule {}
