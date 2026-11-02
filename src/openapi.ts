import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';

async function exportOpenApi() {
  const app = await NestFactory.create(AppModule, { logger: false });

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

  const appName = process.env.APP_NAME || 'Wings of Power';
  const options = new DocumentBuilder()
    .setTitle(`${appName} api`)
    .setDescription(`${appName} api docs`)
    .setVersion('1.0')
    .addTag(`${appName}`)
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, options);

  const requiredPaths = [
    '/api/auth/student/join-code',
    '/api/auth/me',
    '/api/stories',
    '/api/quizzes/{quizId}/attempts',
    '/api/student/home',
    '/api/student/leaderboard',
    '/api/safe-space/reports',
    '/api/teacher/classes',
    '/api/admin/students',
    '/api/admin/stories',
    '/api/game/queue',
    '/api/admin/game/eligibility-config',
  ];

  const missing = requiredPaths.filter(
    (p) => !document.paths || !document.paths[p],
  );
  if (missing.length > 0) {
    await app.close();
    throw new Error(
      `OpenAPI export failed. Missing required paths: ${missing.join(', ')}`,
    );
  }

  const backendRoot = __dirname.includes('dist')
    ? path.resolve(__dirname, '..', '..')
    : path.resolve(__dirname, '..');
  const docsDir = path.join(backendRoot, 'docs');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const outputPath = path.join(docsDir, 'openapi.json');
  fs.writeFileSync(
    outputPath,
    JSON.stringify(document, null, 2) + '\n',
    'utf8',
  );

  console.log(`OpenAPI schema exported successfully to ${outputPath}`);
  console.log(
    'Note: Socket events are not in OpenAPI. See docs/REALTIME.md for realtime event contracts.',
  );

  await app.close();
}

exportOpenApi().catch((err) => {
  console.error(err);
  process.exit(1);
});
