import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

const LOCK_FILE = path.join(os.tmpdir(), 'wings-of-power-e2e.lock');

async function acquireLock(timeoutMs = 60000): Promise<() => void> {
  const start = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx');
      fs.writeSync(fd, `${process.pid}\n${Date.now()}`);
      fs.closeSync(fd);
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          try {
            fs.unlinkSync(LOCK_FILE);
          } catch {
            // ignore
          }
        }
      };
      process.on('exit', release);
      return release;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        try {
          const stats = fs.statSync(LOCK_FILE);
          if (Date.now() - stats.mtimeMs > 60000) {
            fs.unlinkSync(LOCK_FILE);
            continue;
          }
        } catch {
          // ignore
        }
        if (Date.now() - start > timeoutMs) {
          throw new Error('Timed out waiting for e2e lock');
        }
        await new Promise((r) => setTimeout(r, 100));
      } else {
        throw err;
      }
    }
  }
}

export async function createTestApp(): Promise<TestAppContext> {
  const releaseLock = await acquireLock();
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

  const originalClose = app.close.bind(app);
  app.close = async () => {
    try {
      await originalClose();
    } finally {
      releaseLock();
    }
  };

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
