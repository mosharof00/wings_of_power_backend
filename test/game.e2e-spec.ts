import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { io, Socket } from 'socket.io-client';
import * as request from 'supertest';
import {
  GameRoundPhase,
  JoinRequestStatus,
  MatchMode,
  MatchPhase,
  Role,
  RoundType,
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

  describe('T-BE-GAME-012 Realtime Tests (Pass, Q4 Majority, Harmony Suggest)', () => {
    let jwtService: JwtService;
    const testSockets: Socket[] = [];
    const testUsers: any[] = [];
    let opponentUser: any;

    beforeAll(async () => {
      jwtService = app.get(JwtService);
      const hash = await bcrypt.hash('change-me', 10);

      // Create 5 team students
      for (let i = 1; i <= 5; i++) {
        const u = await prisma.user.create({
          data: {
            username: `t_user_${i}_${runId}`,
            password_hash: hash,
            role: Role.STUDENT,
            status: UserStatus.ACTIVE,
            nickname: `TPlayer ${i}`,
            school_id: schoolId,
          },
        });
        testUsers.push(u);
      }

      // Create 1 opponent student
      opponentUser = await prisma.user.create({
        data: {
          username: `t_opp_${runId}`,
          password_hash: hash,
          role: Role.STUDENT,
          status: UserStatus.ACTIVE,
          nickname: `Opponent`,
          school_id: schoolId,
        },
      });
    });

    afterEach(() => {
      while (testSockets.length > 0) {
        const s = testSockets.pop();
        if (s && s.connected) {
          s.close();
        }
      }
    });

    async function connectSocket(u: any): Promise<Socket> {
      const token = jwtService.sign({ sub: u.id, role: Role.STUDENT });
      const s = io(serverUrl, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        autoConnect: false,
      });

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Socket connect timeout')),
          5000,
        );
        s.once('connect', () => {
          clearTimeout(timer);
          resolve();
        });
        s.once('connect_error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        s.connect();
      });

      await new Promise((r) => setTimeout(r, 100));
      testSockets.push(s);
      return s;
    }

    async function createMatchWithTeams(mode: MatchMode, teamLabels: string[]) {
      const match = await prisma.gameMatch.create({
        data: {
          school_id: schoolId,
          mode,
          phase: MatchPhase.PLAYING,
          started_at: new Date(),
        },
      });
      const teams: any[] = [];
      for (const label of teamLabels) {
        const team = await prisma.gameTeam.create({
          data: {
            match_id: match.id,
            label,
            score_xp: 0,
            score_kindness: 0,
            score_baskets: 0,
          },
        });
        teams.push(team);
      }
      return { match, teams };
    }

    it('9. 1v1 match: round:pass is rejected with FORBIDDEN', async () => {
      const { match, teams } = await createMatchWithTeams(MatchMode.ONE_V_ONE, [
        'Solo A',
        'Solo B',
      ]);

      const pSolo = await prisma.gameParticipant.create({
        data: {
          match_id: match.id,
          team_id: teams[0].id,
          user_id: testUsers[0].id,
          is_connected: true,
          jersey_number: 1,
          power_used: false,
        },
      });

      const round1v1 = await prisma.gameRound.create({
        data: {
          match_id: match.id,
          round_type: RoundType.Q1_WARMUP,
          number: 1,
          phase: GameRoundPhase.ANSWER,
          buzz_winner_id: pSolo.id,
          deadline_at: new Date(Date.now() + 10000),
        },
      });

      const socket = await connectSocket(testUsers[0]);

      const errPromise = new Promise<any>((resolve) => {
        socket.once('error', resolve);
      });

      socket.emit('round:pass', { roundId: round1v1.id });

      const err = await errPromise;
      expect(err.code).toBe('FORBIDDEN');
      expect(err.message).toMatch(/1v1 mode|single-player/i);
    });

    it('10. Multi-student match: pass transfers answer right once, original buzzer later answer rejected, teammate grades, second pass rejected', async () => {
      const { match, teams } = await createMatchWithTeams(
        MatchMode.FIVE_V_FIVE,
        ['Team Blue', 'Team Red'],
      );

      const p1 = await prisma.gameParticipant.create({
        data: {
          match_id: match.id,
          team_id: teams[0].id,
          user_id: testUsers[0].id,
          jersey_number: 5,
          is_connected: true,
          power_used: false,
        },
      });
      const p2 = await prisma.gameParticipant.create({
        data: {
          match_id: match.id,
          team_id: teams[0].id,
          user_id: testUsers[1].id,
          jersey_number: 2,
          is_connected: true,
          power_used: false,
        },
      });
      await prisma.gameParticipant.create({
        data: {
          match_id: match.id,
          team_id: teams[0].id,
          user_id: testUsers[2].id,
          jersey_number: 8,
          is_connected: true,
          power_used: false,
        },
      });
      await prisma.gameParticipant.create({
        data: {
          match_id: match.id,
          team_id: teams[1].id,
          user_id: opponentUser.id,
          jersey_number: 1,
          is_connected: true,
          power_used: false,
        },
      });

      const round = await prisma.gameRound.create({
        data: {
          match_id: match.id,
          round_type: RoundType.Q1_WARMUP,
          number: 1,
          phase: GameRoundPhase.ANSWER,
          buzz_winner_id: p1.id,
          deadline_at: new Date(Date.now() + 10000),
        },
      });

      const s1 = await connectSocket(testUsers[0]);
      const s2 = await connectSocket(testUsers[1]);
      const sOpp = await connectSocket(opponentUser);

      // S2 expects round:buzz_winner with deadlineAt reset
      const s2WinnerPromise = new Promise<any>((resolve) => {
        s2.once('round:buzz_winner', resolve);
      });
      // S1 expects round:waiting with reason TEAMMATE
      const s1WaitingPromise = new Promise<any>((resolve) => {
        s1.once('round:waiting', resolve);
      });
      // sOpp expects round:waiting with reason OPPONENT
      const sOppWaitingPromise = new Promise<any>((resolve) => {
        sOpp.once('round:waiting', resolve);
      });

      s1.emit('round:pass', { roundId: round.id });

      const buzzWinner = await s2WinnerPromise;
      expect(buzzWinner.roundId).toBe(round.id);
      expect(buzzWinner.participantId).toBe(p2.id); // Lowest jersey_number (2 < 8)
      expect(buzzWinner.userId).toBe(testUsers[1].id);
      expect(buzzWinner.deadlineAt).toBeDefined();

      const s1Wait = await s1WaitingPromise;
      expect(s1Wait.reason).toBe('TEAMMATE');

      const sOppWait = await sOppWaitingPromise;
      expect(sOppWait.reason).toBe('OPPONENT');

      // Original buzzer s1 calls round:answer -> rejected
      const s1AnswerErrPromise = new Promise<any>((resolve) => {
        s1.once('error', resolve);
      });
      s1.emit('round:answer', { roundId: round.id, optionIndex: 0 });
      const answerErr = await s1AnswerErrPromise;
      expect(answerErr.code).toBe('FORBIDDEN');

      // Second pass from s2 is rejected
      const s2PassErrPromise = new Promise<any>((resolve) => {
        s2.once('error', resolve);
      });
      s2.emit('round:pass', { roundId: round.id });
      const passErr = await s2PassErrPromise;
      expect(passErr.code).toBe('FORBIDDEN');
      expect(passErr.message).toMatch(/pass already used/i);

      // Teammate s2 answers -> grades
      const s2AnswerResultPromise = new Promise<any>((resolve) => {
        s2.once('round:answer_result', resolve);
      });
      s2.emit('round:answer', { roundId: round.id, optionIndex: 0 });
      const ansResult = await s2AnswerResultPromise;
      expect(ansResult.roundId).toBe(round.id);
      expect(ansResult.correct).toBe(true);
    });

    it('11. Harmony power:help_request echoes prompt & options without key; opponent & self suggest rejected; first suggestion relays; later rejected', async () => {
      const { match, teams } = await createMatchWithTeams(
        MatchMode.FIVE_V_FIVE,
        ['Team Harmony', 'Team Rivals'],
      );

      const pAns = await prisma.gameParticipant.create({
        data: {
          match_id: match.id,
          team_id: teams[0].id,
          user_id: testUsers[0].id,
          jersey_number: 1,
          is_connected: true,
          power_used: false,
        },
      });
      await prisma.gameParticipant.create({
        data: {
          match_id: match.id,
          team_id: teams[0].id,
          user_id: testUsers[1].id,
          jersey_number: 2,
          is_connected: true,
          power_used: false,
        },
      });
      await prisma.gameParticipant.create({
        data: {
          match_id: match.id,
          team_id: teams[0].id,
          user_id: testUsers[2].id,
          jersey_number: 3,
          is_connected: true,
          power_used: false,
        },
      });
      await prisma.gameParticipant.create({
        data: {
          match_id: match.id,
          team_id: teams[1].id,
          user_id: opponentUser.id,
          jersey_number: 1,
          is_connected: true,
          power_used: false,
        },
      });

      const round = await prisma.gameRound.create({
        data: {
          match_id: match.id,
          round_type: RoundType.Q3_HOBBY,
          number: 3,
          phase: GameRoundPhase.ANSWER,
          buzz_winner_id: pAns.id,
          deadline_at: new Date(Date.now() + 15000),
        },
      });

      const sAns = await connectSocket(testUsers[0]);
      const sTeam1 = await connectSocket(testUsers[1]);
      const sTeam2 = await connectSocket(testUsers[2]);
      const sOpp = await connectSocket(opponentUser);

      // Teammate 1 expects power:help_request with prompt and options and NO correct index
      const helpReqPromise = new Promise<any>((resolve) => {
        sTeam1.once('power:help_request', resolve);
      });

      sAns.emit('power:help_request', { roundId: round.id });

      const helpReq = await helpReqPromise;
      expect(helpReq.roundId).toBe(round.id);
      expect(helpReq.prompt).toBeDefined();
      expect(Array.isArray(helpReq.options)).toBe(true);
      expect(helpReq.correctIndex).toBeUndefined();

      // Opponent suggest is rejected
      const oppErrPromise = new Promise<any>((resolve) => {
        sOpp.once('error', resolve);
      });
      sOpp.emit('power:help_suggest', {
        roundId: round.id,
        forUserId: testUsers[0].id,
        optionIndex: 0,
      });
      const oppErr = await oppErrPromise;
      expect(oppErr.code).toBe('FORBIDDEN');
      expect(oppErr.message).toMatch(/opponents cannot suggest/i);

      // Self-suggestion rejected
      const selfErrPromise = new Promise<any>((resolve) => {
        sAns.once('error', resolve);
      });
      sAns.emit('power:help_suggest', {
        roundId: round.id,
        forUserId: testUsers[0].id,
        optionIndex: 0,
      });
      const selfErr = await selfErrPromise;
      expect(selfErr.code).toBe('FORBIDDEN');
      expect(selfErr.message).toMatch(/cannot suggest to yourself/i);

      // First valid suggestion from teammate 1 relayed to answerer
      const sugRelayPromise = new Promise<any>((resolve) => {
        sAns.once('power:help_suggest', resolve);
      });

      sTeam1.emit('power:help_suggest', {
        roundId: round.id,
        forUserId: testUsers[0].id,
        optionIndex: 1,
      });

      const relayed = await sugRelayPromise;
      expect(relayed.roundId).toBe(round.id);
      expect(relayed.fromUserId).toBe(testUsers[1].id);
      expect(relayed.optionIndex).toBe(1);
      expect(relayed.correctIndex).toBeUndefined();

      // Later suggestion from teammate 2 rejected
      const secondSugErrPromise = new Promise<any>((resolve) => {
        sTeam2.once('error', resolve);
      });
      sTeam2.emit('power:help_suggest', {
        roundId: round.id,
        forUserId: testUsers[0].id,
        optionIndex: 2,
      });
      const secondSugErr = await secondSugErrPromise;
      expect(secondSugErr.code).toBe('FORBIDDEN');
      expect(secondSugErr.message).toMatch(/already been submitted/i);
    });

    it('12. Q4 Voting: strict majority (3 for 0, 2 for 1) and early resolve before 20s when all 5 vote', async () => {
      const { match, teams } = await createMatchWithTeams(
        MatchMode.FIVE_V_FIVE,
        ['Finalists'],
      );

      for (let i = 0; i < 5; i++) {
        await prisma.gameParticipant.create({
          data: {
            match_id: match.id,
            team_id: teams[0].id,
            user_id: testUsers[i].id,
            jersey_number: i + 1,
            is_connected: true,
            power_used: false,
          },
        });
      }

      const round = await prisma.gameRound.create({
        data: {
          match_id: match.id,
          round_type: RoundType.Q4_FINALS,
          number: 4,
          phase: GameRoundPhase.VOTE,
          deadline_at: new Date(Date.now() + 20000),
        },
      });

      const sockets: Socket[] = [];
      for (let i = 0; i < 5; i++) {
        const s = await connectSocket(testUsers[i]);
        sockets.push(s);
      }

      // Track vote_result event on socket 0
      const voteResultPromise = new Promise<any>((resolve) => {
        sockets[0].once('round:vote_result', resolve);
      });

      const startTime = Date.now();

      // 3 vote for 0, 2 vote for 1
      sockets[0].emit('round:vote', { roundId: round.id, optionIndex: 0 });
      sockets[1].emit('round:vote', { roundId: round.id, optionIndex: 0 });
      sockets[2].emit('round:vote', { roundId: round.id, optionIndex: 0 });
      sockets[3].emit('round:vote', { roundId: round.id, optionIndex: 1 });
      sockets[4].emit('round:vote', { roundId: round.id, optionIndex: 1 });

      const voteResult = await voteResultPromise;
      const elapsed = Date.now() - startTime;

      // Resolved well before 20s (early resolve)
      expect(elapsed).toBeLessThan(10000);
      expect(voteResult.roundId).toBe(round.id);
      expect(voteResult.winningOptionIndex).toBe(0); // 3 > 2 (strict majority)
      expect(voteResult.tallies).toEqual({ 0: 3, 1: 2 });
      expect(voteResult.correct).toBe(true);
    });
  });
});
