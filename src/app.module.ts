// app.module.ts
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { VisionModule } from './vision/vision.module';
import { ImageMetadataModule } from './image-metadata/image-metadata.module';
import { SearchModule } from './search/search.module';
import { CacheModule } from './cache/cache.module';
import { ImageSeedModule } from './image-seed/image-seed.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 100 },
    ]),

    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: +(process.env.REDIS_PORT ?? 6379),
      },
    }),

    BullBoardModule.forRoot({
      route: '/queues',
      adapter: ExpressAdapter,
    }),

    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: +(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      autoLoadEntities: true,
      // RDS rejects unencrypted connections (pg_hba.conf requires SSL). AWS's
      // RDS certs aren't in Node's default CA store, so rejectUnauthorized is
      // off; set DB_SSL=false to disable entirely (e.g. local Postgres).
      ssl:
        process.env.DB_SSL === 'false'
          ? false
          : { rejectUnauthorized: false },
      // This database is shared with Strapi. Our tables live in the dedicated
      // `image_search` schema (see migrations/000_create_image_search_schema.sql)
      // so Strapi's own schema sync never sees/drops them. search_path makes
      // unqualified table names in raw SQL (e.g. image_metadata, fabric) resolve
      // to our schema first, falling back to `public` for Strapi's own tables
      // (fabrics, files, categories, ...) that we still read via raw joins.
      schema: 'image_search',
      extra: {
        options: '-c search_path=image_search,public',
      },
      // Safe to always run: scoped to entities registered in this app only
      // (image_metadata, fabric in the image_search schema), so it can never
      // create/alter/drop anything in Strapi's `public` schema/tables.
      synchronize: true,
    }),

    VisionModule,
    ImageMetadataModule,
    CacheModule,
    SearchModule,
    ImageSeedModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
