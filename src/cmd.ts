import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommandFactory } from 'nest-commander';
import appConfig from './config/app.config';
import { SeedCommand } from './command/seed.command';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    PrismaModule,
  ],
  providers: [SeedCommand],
})
export class AppModule {}

async function bootstrap() {
  await CommandFactory.run(AppModule);
}

bootstrap();
