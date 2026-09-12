import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config();

export default new DataSource({
  type: 'postgres',

  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),

  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD || '',
  database: process.env.DATABASE_NAME || 'tradex',

  ssl:
    process.env.NODE_ENV === 'production' ||
    process.env.DATABASE_SSL === 'true'
      ? {
          rejectUnauthorized: false,
        }
      : false,

  entities: ['src/**/*.entity{.ts,.js}'],
  migrations: ['src/migrations/*{.ts,.js}'],

  synchronize: false,
  logging: true,
});