import {
  Logger,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import appConfig from '../config/app.config';
import { PrismaClient } from 'prisma/generated';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  constructor() {
    const datasourceUrl = appConfig().database.url;

    if (!datasourceUrl) {
      throw new Error('DATABASE_URL is not defined');
    }

    super({
      datasources: {
        db: {
          url: datasourceUrl,
        },
      },
      log: ['error'],
    });

    if (process.env.PRISMA_ENV === '1') {
      this.logger.log('Prisma Middleware disabled');
    }
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Prisma connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
