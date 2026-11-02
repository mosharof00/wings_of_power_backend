import { createHash } from 'crypto';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  AgeGroup,
  AuthCodePurpose,
  ClassCodeStatus,
} from 'prisma/generated/client';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanDb,
  createTestApp,
  restoreSeed,
  TestAppContext,
} from './helpers/app';
import { TestMailService } from './helpers/mail';

describe('Identity journey (e2e)', () => {
  let context: TestAppContext;
  let app: INestApplication;
  let prisma: PrismaService;
  let mailService: TestMailService;

  const runId = Math.random().toString(36).slice(2, 8);
  const adminEmail = `admin_${runId}@e2e.test`;
  const adminPassword = 'AdminPassword123!';
  const teacherEmail = `teacher_${runId}@e2e.test`;
  const teacherPassword = 'TeacherPassword123!';
  const studentUsername = `student_${runId}`;
  const studentPassword = 'StudentPassword123!';
  const schoolName = `E2E School ${runId}`;

  let adminToken: string;
  let adminId: string;
  let teacherToken: string;
  let teacherId: string;
  let classId: string;
  let classCode: string;
  let studentId: string;
  let pendingStudentToken: string;
  let activeStudentToken: string;
  let membershipId: string;

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;
    prisma = context.prisma;
    mailService = context.mailService;

    await cleanDb(prisma);
  });

  afterAll(async () => {
    await cleanDb(prisma);
    await restoreSeed(prisma);
    await app.close();
  });

  it('1. Admin register -> verify -> school profile -> admin login', async () => {
    // 1.1 Admin register
    const regRes = await request(app.getHttpServer())
      .post('/api/auth/admin/register')
      .send({
        name: 'E2E Admin',
        email: adminEmail,
        password: adminPassword,
        confirmPassword: adminPassword,
      })
      .expect(201);

    expect(regRes.body.success).toBe(true);
    expect(regRes.body.data.user.email).toBe(adminEmail);
    expect(regRes.body.data.user.role).toBe('ADMIN');
    expect(regRes.body.data.user.status).toBe('PENDING');
    adminId = regRes.body.data.user.id;

    // Read AuthCode via Prisma and test helper
    const authCodeRow = await prisma.authCode.findFirst({
      where: { email: adminEmail, purpose: AuthCodePurpose.VERIFY_EMAIL },
      orderBy: { created_at: 'desc' },
    });
    expect(authCodeRow).toBeDefined();

    // Verify raw OTP captured by the mail mock matches the stored hash
    const otp = mailService.getOtp(adminEmail);
    expect(otp).toBeDefined();
    expect(authCodeRow!.code_hash).toBe(
      createHash('sha256').update(otp!).digest('hex'),
    );

    // 1.2 Admin verify email
    const verifyRes = await request(app.getHttpServer())
      .post('/api/auth/admin/verify-email')
      .send({
        email: adminEmail,
        code: otp,
      })
      .expect(201);

    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.data.user.status).toBe('ACTIVE');

    // 1.3 Initial staff login to acquire JWT for school profile onboarding
    const initialLoginRes = await request(app.getHttpServer())
      .post('/api/auth/staff/login')
      .send({
        email: adminEmail,
        password: adminPassword,
      })
      .expect(201);

    expect(initialLoginRes.body.success).toBe(true);
    const initialToken = initialLoginRes.body.data.accessToken;
    expect(initialToken).toBeDefined();

    // 1.4 Admin creates school profile
    const schoolRes = await request(app.getHttpServer())
      .post('/api/auth/school')
      .set('Authorization', `Bearer ${initialToken}`)
      .send({
        name: schoolName,
      })
      .expect(201);

    expect(schoolRes.body.success).toBe(true);
    expect(schoolRes.body.data.name).toBe(schoolName);

    // 1.5 Admin logs in after school setup
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/admin/login')
      .send({
        email: adminEmail,
        password: adminPassword,
      })
      .expect(201);

    expect(loginRes.body.success).toBe(true);
    adminToken = loginRes.body.data.accessToken;
    expect(adminToken).toBeDefined();
  });

  it('2. Invite teacher -> read token -> teacher accepts invite & logs in', async () => {
    // 2.1 Admin invites teacher
    const inviteRes = await request(app.getHttpServer())
      .post('/api/admin/staff/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: teacherEmail,
        canAccessSafeSpace: false,
      })
      .expect(201);

    expect(inviteRes.body.success).toBe(true);

    // 2.2 Read token intercepted by mail mock and compare hash with DB
    const teacherRawToken = mailService.getInviteToken(teacherEmail);
    expect(teacherRawToken).toBeDefined();

    const inviteRow = await prisma.staffInvite.findFirst({
      where: { email: teacherEmail },
      orderBy: { created_at: 'desc' },
    });
    expect(inviteRow).toBeDefined();
    expect(inviteRow!.token_hash).toBe(
      createHash('sha256').update(teacherRawToken!).digest('hex'),
    );

    // 2.3 Teacher accepts invite
    const acceptRes = await request(app.getHttpServer())
      .post('/api/auth/teacher/accept-invite')
      .send({
        token: teacherRawToken,
        name: 'E2E Teacher',
        password: teacherPassword,
        confirmPassword: teacherPassword,
      })
      .expect(201);

    expect(acceptRes.body.success).toBe(true);
    expect(acceptRes.body.data.user.role).toBe('TEACHER');
    expect(acceptRes.body.data.user.status).toBe('ACTIVE');
    teacherId = acceptRes.body.data.user.id;

    // 2.4 Teacher logs in with staff login
    const teacherLoginRes = await request(app.getHttpServer())
      .post('/api/auth/staff/login')
      .send({
        email: teacherEmail,
        password: teacherPassword,
      })
      .expect(201);

    expect(teacherLoginRes.body.success).toBe(true);
    teacherToken = teacherLoginRes.body.data.accessToken;
    expect(teacherToken).toBeDefined();
  });

  it('3. Admin creates class & receives code', async () => {
    const classRes = await request(app.getHttpServer())
      .post('/api/admin/classes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Grade 4 · Amber',
        grade: 'Grade 4',
        ageGroup: AgeGroup.AGE_6_9,
        teacherId: teacherId,
      })
      .expect(201);

    expect(classRes.body.success).toBe(true);
    classId = classRes.body.data.id;
    classCode = classRes.body.data.code;
    expect(classId).toBeDefined();
    expect(classCode).toBeDefined();
    expect(classCode.length).toBeGreaterThan(0);
  });

  it('4. Student join-code, register, GET /api/auth/me shows PENDING, login returns 422', async () => {
    // 4.1 Preview join code
    const joinRes = await request(app.getHttpServer())
      .post('/api/auth/student/join-code')
      .send({ code: classCode })
      .expect(201);

    expect(joinRes.body.success).toBe(true);
    expect(joinRes.body.data.classId).toBe(classId);

    // 4.2 Student register
    const regRes = await request(app.getHttpServer())
      .post('/api/auth/student/register')
      .send({
        code: classCode,
        username: studentUsername,
        password: studentPassword,
        confirmPassword: studentPassword,
        nickname: 'E2EKid',
        realName: 'E2E Kid Real',
      })
      .expect(201);

    expect(regRes.body.success).toBe(true);
    studentId = regRes.body.data.user.id;
    pendingStudentToken = regRes.body.data.accessToken;
    expect(studentId).toBeDefined();
    expect(pendingStudentToken).toBeDefined();

    // 4.3 GET /api/auth/me shows PENDING
    const meRes = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${pendingStudentToken}`)
      .expect(200);

    expect(meRes.body.success).toBe(true);
    expect(meRes.body.data.status).toBe('PENDING');

    // 4.4 Student login returns 422
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/student/login')
      .send({
        username: studentUsername,
        password: studentPassword,
      })
      .expect(422);

    expect(loginRes.body.message).toBe('PENDING');
  });

  it('5. Teacher approves membership, Admin approves user, Student login returns token', async () => {
    // 5.1 Teacher views pending join requests
    const joinRequestsRes = await request(app.getHttpServer())
      .get(`/api/teacher/classes/${classId}/join-requests`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);

    expect(joinRequestsRes.body.success).toBe(true);
    const items = joinRequestsRes.body.data.items;
    const pendingMembership = items.find(
      (item: any) => item.student?.id === studentId,
    );
    expect(pendingMembership).toBeDefined();
    membershipId = pendingMembership.id;

    // 5.2 Teacher approves membership
    const teacherApproveRes = await request(app.getHttpServer())
      .post(`/api/teacher/join-requests/${membershipId}/approve`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(201);

    expect(teacherApproveRes.body.success).toBe(true);
    expect(teacherApproveRes.body.data.status).toBe('APPROVED');

    // 5.3 Admin approves user
    const adminApproveRes = await request(app.getHttpServer())
      .post(`/api/admin/students/${studentId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    expect(adminApproveRes.body.success).toBe(true);
    expect(adminApproveRes.body.data.status).toBe('ACTIVE');

    // 5.4 Student login returns token
    const studentLoginRes = await request(app.getHttpServer())
      .post('/api/auth/student/login')
      .send({
        username: studentUsername,
        password: studentPassword,
      })
      .expect(201);

    expect(studentLoginRes.body.success).toBe(true);
    activeStudentToken = studentLoginRes.body.data.accessToken;
    expect(activeStudentToken).toBeDefined();
    expect(studentLoginRes.body.data.user.status).toBe('ACTIVE');
  });

  it('6. Teacher roster includes student, Admin student list ACTIVE includes student', async () => {
    // 6.1 Teacher roster
    const rosterRes = await request(app.getHttpServer())
      .get('/api/teacher/students')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);

    expect(rosterRes.body.success).toBe(true);
    const rosterStudents = rosterRes.body.data.items;
    const foundInRoster = rosterStudents.find((s: any) => s.id === studentId);
    expect(foundInRoster).toBeDefined();
    expect(foundInRoster.username).toBe(studentUsername);

    // 6.2 Admin student list ACTIVE
    const adminStudentsRes = await request(app.getHttpServer())
      .get('/api/admin/students?status=ACTIVE')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(adminStudentsRes.body.success).toBe(true);
    const activeStudents = adminStudentsRes.body.data.items;
    const foundInAdmin = activeStudents.find((s: any) => s.id === studentId);
    expect(foundInAdmin).toBeDefined();
    expect(foundInAdmin.status).toBe('ACTIVE');
  });

  describe('Negative checks', () => {
    it('wrong code returns 404', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/student/join-code')
        .send({ code: 'WRONG-9999' })
        .expect(404);
    });

    it('student token cannot GET /api/admin/students (403)', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/students')
        .set('Authorization', `Bearer ${activeStudentToken}`)
        .expect(403);
    });

    it('expired code fixture returns 422', async () => {
      const expiredCode = `EXPD-${runId.slice(0, 4).toUpperCase()}`;
      await prisma.classCode.create({
        data: {
          class_id: classId,
          code: expiredCode,
          status: ClassCodeStatus.EXPIRED,
          created_by_id: adminId,
          expires_at: new Date(Date.now() - 60000),
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/student/join-code')
        .send({ code: expiredCode })
        .expect(422);

      expect(res.body.message).toBe('EXPIRED_CODE');
    });
  });
});
