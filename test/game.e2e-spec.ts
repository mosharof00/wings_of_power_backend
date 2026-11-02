import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { io, Socket } from 'socket.io-client';
import * as request from 'supertest';
import {
  JoinRequestStatus,
  MatchMode,
  MatchPhase,
  Role,
  UserStatus,
} from 'prisma/generated/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, restoreSeed, TestAppContext } from './helpers/app';

describe('Game REST & Socket connect (e2e)', () => {
  let context: TestAppContext;
  let app: INestApplication;
  let prisma: PrismaService;
  let serverUrl: string;
  let port: number;

  const runId = Math.random().toString(36).slice(2, 8);
  let adminToken: string;
  let schoolId: string;

  let studentToken: string;
  let studentId: string;

  let student2Token: string;
  let student2Id: string;

  let singleMatchId: string;
  let socketMatchId: string;

  beforeAll(async () => {
    context = await createTestApp({ listen: true });
    app = context.app;
    prisma = context.prisma;
    serverUrl = context.serverUrl!;
    port = context.port!;
    expect(port).toBeGreaterThan(0);

    // Ensure seed is present
    const demoAdmin = await prisma.user.findFirst({
      where: { email: 'admin@demo.school' },
    });
    if (!demoAdmin) {
      await restoreSeed(prisma);
    }

    const school = await prisma.school.findFirst({
      where: { name: 'Demo Elementary' },
    });
    schoolId = school!.id;

    // 1. Admin login
    const adminLoginRes = await request(app.getHttpServer())
      .post('/api/auth/admin/login')
      .send({
        email: 'admin@demo.school',
        password: 'change-me',
      })
      .expect(201);
    adminToken = adminLoginRes.body.data.accessToken;

    // 2. Student 1 login (student.active)
    const studentLoginRes = await request(app.getHttpServer())
      .post('/api/auth/student/login')
      .send({
        username: 'student.active',
        password: 'change-me',
      })
      .expect(201);
    studentToken = studentLoginRes.body.data.accessToken;
    studentId = studentLoginRes.body.data.user.id;

    // Ensure student 1 has chapter progress with quiz score so eligibility succeeds
    const chapter = await prisma.chapter.findFirst({
      where: { story: { school_id: schoolId } },
    });
    if (chapter) {
      await prisma.chapterProgress.upsert({
        where: {
          user_id_chapter_id: {
            user_id: studentId,
            chapter_id: chapter.id,
          },
        },
        create: {
          user_id: studentId,
          chapter_id: chapter.id,
          percent: 100,
          quiz_best_percent: 100,
          completed_at: new Date(),
        },
        update: {
          percent: 100,
          quiz_best_percent: 100,
          completed_at: new Date(),
        },
      });
    }

    // 3. Create second student (student2) who has NO progress (ineligible)
    const cls = await prisma.class.findFirst({
      where: { school_id: schoolId },
    });
    const hash = await bcrypt.hash('change-me', 10);
    const student2User = await prisma.user.create({
      data: {
        username: `student2_${runId}`,
        password_hash: hash,
        role: Role.STUDENT,
        status: UserStatus.ACTIVE,
        nickname: `Student Two ${runId}`,
        real_name: `Two Real ${runId}`,
        school_id: schoolId,
      },
    });
    student2Id = student2User.id;

    if (cls) {
      await prisma.classMembership.create({
        data: {
          user_id: student2Id,
          class_id: cls.id,
          status: JoinRequestStatus.APPROVED,
          approved_at: new Date(),
        },
      });
    }

    // Student 2 login
    const student2LoginRes = await request(app.getHttpServer())
      .post('/api/auth/student/login')
      .send({
        username: `student2_${runId}`,
        password: 'change-me',
      })
      .expect(201);
    student2Token = student2LoginRes.body.data.accessToken;
  });

  afterAll(async () => {
    // Restore eligibility config to 2 / 6 / 70
    try {
      await request(app.getHttpServer())
        .patch('/api/admin/game/eligibility-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          requiredStories: 2,
          requiredChapters: 6,
          minQuizPercent: 70,
        });
    } catch {
      // ignore
    }

    try {
      await prisma.gameEligibilityConfig.upsert({
        where: { school_id: schoolId },
        create: {
          school_id: schoolId,
          required_stories: 2,
          required_chapters: 6,
          min_quiz_percent: 70,
        },
        update: {
          required_stories: 2,
          required_chapters: 6,
          min_quiz_percent: 70,
        },
      });
    } catch {
      // ignore
    }

    // Cleanup matches and tickets created by test
    try {
      const matchIds = [singleMatchId, socketMatchId].filter(Boolean);
      if (matchIds.length > 0) {
        await prisma.gameMatch.updateMany({
          where: { id: { in: matchIds } },
          data: { phase: MatchPhase.CANCELLED },
        });
        await prisma.gameParticipant.deleteMany({
          where: { match_id: { in: matchIds } },
        });
        await prisma.gameTeam.deleteMany({
          where: { match_id: { in: matchIds } },
        });
        await prisma.gameMatch.deleteMany({
          where: { id: { in: matchIds } },
        });
      }
      await prisma.matchmakingTicket.deleteMany({
        where: { user_id: { in: [studentId, student2Id] } },
      });
      if (student2Id) {
        await prisma.classMembership.deleteMany({
          where: { user_id: student2Id },
        });
        await prisma.user.deleteMany({
          where: { id: student2Id },
        });
      }
    } catch {
      // ignore
    }

    await app.close();
  });

  it('1. Patch eligibility config to 0/0/0 for test school', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/admin/game/eligibility-config')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        requiredStories: 0,
        requiredChapters: 0,
        minQuizPercent: 0,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.requiredStories).toBe(0);
    expect(res.body.data.requiredChapters).toBe(0);
    expect(res.body.data.minQuizPercent).toBe(0);
  });

  it('2. GET /api/game/eligibility -> true for student with progress under 0/0/0 config', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/game/eligibility')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.eligible).toBe(true);
  });

  it('3. POST /api/game/queue (SINGLE) returns matchId', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/game/queue')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ mode: MatchMode.SINGLE })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.matchId).toBeDefined();
    expect(typeof res.body.data.matchId).toBe('string');
    singleMatchId = res.body.data.matchId;
  });

  it('4. GET /api/game/matches/:id is 200 for participant student, 403 for second student', async () => {
    const okRes = await request(app.getHttpServer())
      .get(`/api/game/matches/${singleMatchId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(okRes.body.success).toBe(true);
    expect(okRes.body.data.id).toBe(singleMatchId);

    const forbiddenRes = await request(app.getHttpServer())
      .get(`/api/game/matches/${singleMatchId}`)
      .set('Authorization', `Bearer ${student2Token}`)
      .expect(403);

    expect(forbiddenRes.body.message).toMatch(/Forbidden|participant/i);
  });

  it('5. DELETE /api/game/queue after second attempt -> 409 then cancel works', async () => {
    // 5.1 Enqueue student for 1v1 multiplayer
    const firstRes = await request(app.getHttpServer())
      .post('/api/game/queue')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ mode: MatchMode.ONE_V_ONE })
      .expect(201);

    expect(firstRes.body.success).toBe(true);

    // 5.2 Second attempt returns 409 Conflict
    const conflictRes = await request(app.getHttpServer())
      .post('/api/game/queue')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ mode: MatchMode.ONE_V_ONE })
      .expect(409);

    expect(conflictRes.body.message).toMatch(/Already queued/i);

    // 5.3 Cancel ticket returns 200
    const cancelRes = await request(app.getHttpServer())
      .delete('/api/game/queue')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(cancelRes.body.success).toBe(true);

    // 5.4 Re-enqueuing now succeeds
    const reQueueRes = await request(app.getHttpServer())
      .post('/api/game/queue')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ mode: MatchMode.ONE_V_ONE })
      .expect(201);

    expect(reQueueRes.body.success).toBe(true);

    // Clean up queue ticket
    await request(app.getHttpServer())
      .delete('/api/game/queue')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
  });

  it('6. Socket.io client connects with student JWT, stays open. Bad token disconnects.', async () => {
    // 6.1 Valid JWT connection
    const validSocket: Socket = io(serverUrl, {
      auth: { token: studentToken },
      transports: ['websocket'],
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Socket connection timeout')),
        5000,
      );
      validSocket.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      validSocket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    expect(validSocket.connected).toBe(true);

    // Connection stays open
    await new Promise((r) => setTimeout(r, 600));
    expect(validSocket.connected).toBe(true);
    validSocket.close();

    // 6.2 Bad token disconnects
    const badSocket: Socket = io(serverUrl, {
      auth: { token: 'invalid.jwt.token' },
      transports: ['websocket'],
      reconnection: false,
    });

    const badSocketDisconnected = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      badSocket.on('connect_error', () => {
        clearTimeout(timer);
        resolve(true);
      });
      badSocket.on('disconnect', () => {
        clearTimeout(timer);
        resolve(true);
      });
      badSocket.on('connect', () => {
        // If connected, wait for gateway disconnect
        badSocket.on('disconnect', () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
    });

    expect(badSocketDisconnected).toBe(true);
    expect(badSocket.connected).toBe(false);
    badSocket.close();
  });

  it('7. Socket emit queue:join { mode: SINGLE } receives match:snapshot or match:found', async () => {
    const gameSocket: Socket = io(serverUrl, {
      auth: { token: studentToken },
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
    });

    const matchEventPromise = new Promise<{ event: string; payload: any }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error('Timeout waiting for match:found or match:snapshot'),
            ),
          5000,
        );
        gameSocket.once('match:found', (payload) => {
          clearTimeout(timer);
          resolve({ event: 'match:found', payload });
        });
        gameSocket.once('match:snapshot', (payload) => {
          clearTimeout(timer);
          resolve({ event: 'match:snapshot', payload });
        });
        gameSocket.on('queue:error', (err) => {
          clearTimeout(timer);
          reject(new Error(`queue:error: ${JSON.stringify(err)}`));
        });
        gameSocket.on('error', (err) => {
          clearTimeout(timer);
          reject(new Error(`error: ${JSON.stringify(err)}`));
        });
      },
    );

    gameSocket.connect();

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Socket connection timeout')),
        5000,
      );
      gameSocket.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      gameSocket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // Wait for server handleConnection async DB lookups to populate client.data.user
    await new Promise((r) => setTimeout(r, 200));

    gameSocket.emit('queue:join', { mode: MatchMode.SINGLE });

    const received = await matchEventPromise;
    expect(received).toBeDefined();
    expect(received.payload).toBeDefined();
    socketMatchId = received.payload.matchId;
    expect(typeof socketMatchId).toBe('string');
    expect(socketMatchId.length).toBeGreaterThan(0);

    gameSocket.close();
  });

  it('8. Ineligible student gets 422 on queue', async () => {
    // student2 has no progress/quiz scores, so eligibility check fails
    const res = await request(app.getHttpServer())
      .post('/api/game/queue')
      .set('Authorization', `Bearer ${student2Token}`)
      .send({ mode: MatchMode.SINGLE })
      .expect(422);

    expect(res.body.message).toMatch(/not eligible/i);
  });
});
