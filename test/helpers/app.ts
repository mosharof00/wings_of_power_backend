import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { CustomExceptionFilter } from '../../src/common/exception/custom-exception.filter';
import { PrismaExceptionFilter } from '../../src/common/exception/prisma-exception.filter';
import { MailService } from '../../src/mail/mail.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { executeSeed } from '../../src/command/seed.data';
import { TestMailService } from './mail';

export interface TestAppContext {
  app: INestApplication;
  moduleFixture: TestingModule;
  prisma: PrismaService;
  mailService: TestMailService;
}

export async function createTestApp(): Promise<TestAppContext> {
  const mailService = new TestMailService();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MailService)
    .useValue(mailService)
    .compile();

  const app = moduleFixture.createNestApplication();

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.useGlobalFilters(
    new CustomExceptionFilter(),
    new PrismaExceptionFilter(),
  );

  await app.init();

  const prisma = app.get(PrismaService);

  return {
    app,
    moduleFixture,
    prisma,
    mailService,
  };
}

export async function cleanDb(prisma: PrismaService): Promise<void> {
  const tablenames = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename != '_prisma_migrations';
  `;

  const tables = tablenames.map(({ tablename }) => `"${tablename}"`).join(', ');

  if (tables.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
  }
}

export async function restoreSeed(prisma: PrismaService): Promise<void> {
  await executeSeed(prisma);
}
