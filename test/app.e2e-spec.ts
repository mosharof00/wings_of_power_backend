import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, TestAppContext } from './helpers/app';

describe('AppController (e2e)', () => {
  let context: TestAppContext;
  let app: INestApplication;

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api (GET)', () => {
    return request(app.getHttpServer())
      .get('/api')
      .expect(200)
      .expect('Wings of Power');
  });
});
