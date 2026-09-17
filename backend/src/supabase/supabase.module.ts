import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_ADMIN_CLIENT = 'SUPABASE_ADMIN_CLIENT';

/**
 * Provides a single Supabase JS client authenticated with the service-role key.
 * This client is trusted (backend-only) and must NEVER be exposed to the
 * frontend. It is used to verify end-user access tokens and to read the
 * authenticated Supabase identity.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: SUPABASE_ADMIN_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SupabaseClient => {
        const url = config.get<string>('SUPABASE_URL');
        const serviceRole = config.get<string>('SUPABASE_SERVICE_ROLE_KEY');

        if (!url || !serviceRole) {
          throw new Error(
            'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured',
          );
        }

        return createClient(url, serviceRole, {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        });
      },
    },
  ],
  exports: [SUPABASE_ADMIN_CLIENT],
})
export class SupabaseModule {}
