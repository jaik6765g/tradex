import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Correlation id on every request (echoed as x-request-id) so a failing
  // request can be traced to its exact exception in the server logs.
  app.use(requestIdMiddleware);

  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'https://tradex-lovat.vercel.app',
    ],
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Never hide the real exception behind a generic 500: log the true error
  // (name, message, stack) with request context, and return a structured body
  // carrying `code`, `exception` and `requestId`.
  app.useGlobalFilters(new AllExceptionsFilter());

  const configService = app.get(ConfigService);

  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const dbHost = configService.get<string>('DATABASE_HOST', 'localhost');
  const dbPort = configService.get<string>('DATABASE_PORT', '5432');
  const dbName = configService.get<string>('DATABASE_NAME', 'tradex');
  const redisUrl = configService.get<string>('REDIS_URL');
  const supabaseUrl = configService.get<string>('SUPABASE_URL');
  const bscRpc = configService.get<string>('BSC_RPC_URL');

  let redisSummary = 'missing';
  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl);
      redisSummary = `${parsed.hostname}:${parsed.port || '6379'}`;
    } catch {
      redisSummary = 'configured (unparseable)';
    }
  }

  let supabaseSummary = 'missing';
  if (supabaseUrl) {
    try {
      supabaseSummary = new URL(supabaseUrl).host;
    } catch {
      supabaseSummary = 'configured';
    }
  }

  console.log('════════════════════════════════════════════');
  console.log('TradeX backend starting');
  console.log(`Environment: ${nodeEnv}`);
  console.log(`Database: ${dbHost}:${dbPort}/${dbName}`);
  console.log(`Redis: ${redisSummary}`);
  console.log(`Supabase: ${supabaseSummary}`);
  console.log(`BSC RPC: ${bscRpc ? 'configured' : 'missing'}`);
  console.log('════════════════════════════════════════════');

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();