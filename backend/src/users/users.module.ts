import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from './user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

import { LedgerEntry } from '../ledger/ledger.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, LedgerEntry])],

  controllers: [UsersController],

  providers: [UsersService],

  exports: [UsersService],
})
export class UsersModule {}
