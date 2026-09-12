import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config();

const isProduction = process.env.NODE_ENV === 'production';

export default new DataSource({
  type: 'postgres',

  // Render PostgreSQL DATABASE_URL ko priority do
  url: process.env.DATABASE_URL,

  // Local development ke liye fallback
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD || '',
  database: process.env.DATABASE_NAME || 'tradex',

  ssl: isProduction || process.env.DATABASE_SSL === 'true'
    ? {
        rejectUnauthorized: false,
      }
    : false,

  entities: ['src/**/*.entity{.ts,.js}'],
  migrations: ['src/migrations/*{.ts,.js}'],

  synchronize: false,
  logging: true,
});