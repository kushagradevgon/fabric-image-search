import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));

  try {
    const dataSource = app.get(DataSource);
    await dataSource.query('CREATE EXTENSION IF NOT EXISTS vector');
  } catch (err) {
    console.warn('pgvector extension check failed:', err);
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
