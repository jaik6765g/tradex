import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { SupabaseModule } from '../supabase/supabase.module';

import { MobileAuthController } from './mobile-auth.controller';
import { MobileAuthService } from './mobile-auth.service';
import { SupabaseJwtStrategy } from './strategies/supabase-jwt.strategy';

@Module({
  imports: [
    SupabaseModule,
    UsersModule,
    WalletsModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [MobileAuthController],
  providers: [MobileAuthService, SupabaseJwtStrategy],
  exports: [MobileAuthService],
})
export class AuthModule {}
