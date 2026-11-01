import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from 'prisma/generated/client';
import appConfig from '../config/app.config';
import { softDeleteExtension } from './middleware/softdelete.middleware';

function createClient() {
  const datasourceUrl = appConfig().database.url;

  if (!datasourceUrl) {
    throw new Error('DATABASE_URL is not defined');
  }

  return new PrismaClient({
    datasources: {
      db: {
        url: datasourceUrl,
      },
    },
    log: ['error'],
  }).$extends(softDeleteExtension);
}

export type WingsPrismaClient = ReturnType<typeof createClient>;

// Declaration merge keeps `prisma.user` on the Nest class that owns onModuleInit.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
export interface PrismaService extends WingsPrismaClient {}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly client: WingsPrismaClient;

  constructor() {
    this.client = createClient();

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }
        const value = Reflect.get(target.client as object, prop);
        return typeof value === 'function' ? value.bind(target.client) : value;
      },
    });
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
