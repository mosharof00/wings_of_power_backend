import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommandFactory } from 'nest-commander';
import appConfig from './config/app.config';
import { SeedCommand } from './command/seed.command';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
  ],
  providers: [SeedCommand],
})
export class AppModule {}

async function bootstrap() {
  await CommandFactory.run(AppModule);
}

bootstrap();
