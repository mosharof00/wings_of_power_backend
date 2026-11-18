// external imports
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { join } from 'path';
// internal imports
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { CustomExceptionFilter } from './common/exception/custom-exception.filter';
import { PrismaExceptionFilter } from './common/exception/prisma-exception.filter';
import { TajulStorage } from './common/lib/Disk/TajulStorage';
import appConfig from './config/app.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useWebSocketAdapter(new IoAdapter(app));
  app.setGlobalPrefix('api');
  app.enableCors();
  // Media URLs are loaded by the dashboard (and later the app) from another
  // origin (e.g. :3000 → :6001). Helmet's default CORP "same-origin" blocks
  // those <img>/<audio> requests and shows a broken preview.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.useStaticAssets(join(process.cwd(), 'public'), {
    index: false,
    prefix: '/public',
  });
  app.useStaticAssets(join(process.cwd(), 'public/storage'), {
    index: false,
    prefix: '/storage',
  });

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

  // storage setup — FILESYSTEM_DISK=local|s3 (default local for dev/hosting without cloud)
  const disk = (process.env.FILESYSTEM_DISK || 'local').toLowerCase();
  TajulStorage.config({
    driver: disk === 's3' ? 's3' : 'local',
    connection: {
      rootUrl: appConfig().storageUrl.rootUrl,
      publicUrl: appConfig().storageUrl.rootUrlPublic,
      awsBucket: appConfig().fileSystems.s3.bucket,
      awsAccessKeyId: appConfig().fileSystems.s3.key,
      awsSecretAccessKey: appConfig().fileSystems.s3.secret,
      awsDefaultRegion: appConfig().fileSystems.s3.region,
      awsEndpoint: appConfig().fileSystems.s3.endpoint,
      // Path-style only when explicitly needed (MinIO / some S3-compatible hosts).
      minio: process.env.AWS_FORCE_PATH_STYLE === 'true',
    },
  });

  // swagger
  const options = new DocumentBuilder()
    .setTitle(`${process.env.APP_NAME} api`)
    .setDescription(`${process.env.APP_NAME} api docs`)
    .setVersion('1.0')
    .addTag(`${process.env.APP_NAME}`)
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, options);

  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(process.env.PORT ?? 6001, '0.0.0.0');
}
bootstrap();
