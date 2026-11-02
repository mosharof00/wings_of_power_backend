import { createHash } from 'crypto';
import { HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthCodePurpose, Role, UserStatus } from 'prisma/generated/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';

function hashCode(code: string) {
  return createHash('sha256').update(code).digest('hex');
}

function expectStatus(error: unknown, status: number) {
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(status);
}

describe('AuthService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    authCode: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    school: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    classCode: {
      findFirst: jest.fn(),
    },
    classMembership: {
      create: jest.fn(),
    },
    hero: {
      findFirst: jest.fn(),
    },
    studentHeroUnlock: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    staffInvite: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const mail = { sendOtpCodeToEmail: jest.fn() };
  const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    mail as unknown as MailService,
    jwt as unknown as JwtService,
  );

  const registerDto = {
    name: 'Ada Admin',
    email: 'Admin@Demo.school',
    password: 'password1',
    confirmPassword: 'password1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers an admin as pending and hashes the password', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }) => ({
      id: 'user-1',
      school_id: null,
      ...data,
    }));
    prisma.authCode.create.mockResolvedValue({ id: 'code-1' });

    const result = await service.registerAdmin(registerDto);

    const created = prisma.user.create.mock.calls[0][0].data;
    expect(created.role).toBe(Role.ADMIN);
    expect(created.status).toBe(UserStatus.PENDING);
    expect(created.email).toBe('admin@demo.school');
    expect(created.password_hash).not.toBe(registerDto.password);
    await expect(
      bcrypt.compare(registerDto.password, created.password_hash),
    ).resolves.toBe(true);

    const code = prisma.authCode.create.mock.calls[0][0].data;
    expect(code.purpose).toBe(AuthCodePurpose.VERIFY_EMAIL);
    expect(code.code_hash).not.toBe(
      mail.sendOtpCodeToEmail.mock.calls[0][0].otp,
    );
    expect(code.expires_at.getTime()).toBeGreaterThan(
      Date.now() + 14 * 60 * 1000,
    );
    expect(code.expires_at.getTime()).toBeLessThan(Date.now() + 16 * 60 * 1000);
    expect(result.data.user.status).toBe(UserStatus.PENDING);
    expect(result.data.user).not.toHaveProperty('password_hash');
  });

  it('rejects a second register for the same email', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });

    try {
      await service.registerAdmin(registerDto);
      throw new Error('expected conflict');
    } catch (error) {
      expectStatus(error, 409);
    }
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('turns a pending admin active when the code is valid', async () => {
    const code = '453210';
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'admin@demo.school',
      role: Role.ADMIN,
      status: UserStatus.PENDING,
    });
    prisma.authCode.findFirst.mockResolvedValue({
      id: 'code-1',
      code_hash: hashCode(code),
      used_at: null,
      expires_at: new Date(Date.now() + 60_000),
    });
    prisma.user.update.mockImplementation(async ({ data }) => ({
      id: 'user-1',
      email: 'admin@demo.school',
      role: Role.ADMIN,
      school_id: null,
      real_name: 'Ada Admin',
      ...data,
    }));

    const result = await service.verifyEmail({
      email: 'admin@demo.school',
      code,
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        status: UserStatus.ACTIVE,
        email_verified_at: expect.any(Date),
      }),
    });
    expect(prisma.authCode.update).toHaveBeenCalledWith({
      where: { id: 'code-1' },
      data: { used_at: expect.any(Date) },
    });
    expect(result.data.user.status).toBe(UserStatus.ACTIVE);
  });

  it('rejects a wrong verification code', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      role: Role.ADMIN,
    });
    prisma.authCode.findFirst.mockResolvedValue(null);

    try {
      await service.verifyEmail({
        email: 'admin@demo.school',
        code: '000000',
      });
      throw new Error('expected bad request');
    } catch (error) {
      expectStatus(error, 400);
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects a used verification code', async () => {
    const code = '453210';
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      role: Role.ADMIN,
    });
    prisma.authCode.findFirst.mockResolvedValue({
      id: 'code-1',
      code_hash: hashCode(code),
      used_at: new Date(),
      expires_at: new Date(Date.now() + 60_000),
    });

    try {
      await service.verifyEmail({ email: 'admin@demo.school', code });
      throw new Error('expected bad request');
    } catch (error) {
      expectStatus(error, 400);
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects login before the email is verified', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      role: Role.ADMIN,
      status: UserStatus.PENDING,
      password_hash: await bcrypt.hash('password1', 4),
    });

    try {
      await service.loginAdmin({
        email: 'admin@demo.school',
        password: 'password1',
      });
      throw new Error('expected unauthorized');
    } catch (error) {
      expectStatus(error, 401);
    }
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('rejects a student on staff login', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      role: Role.STUDENT,
      status: UserStatus.ACTIVE,
      password_hash: await bcrypt.hash('password1', 4),
    });

    try {
      await service.loginStaff({
        email: 'student@demo.school',
        password: 'password1',
      });
      throw new Error('expected unauthorized');
    } catch (error) {
      expectStatus(error, 401);
    }
  });

  it('rejects a second school profile', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      role: Role.ADMIN,
      school_id: null,
    });
    prisma.school.findFirst.mockResolvedValue({ id: 'school-1' });

    try {
      await service.createSchool('user-1', { name: 'Other School' });
      throw new Error('expected conflict');
    } catch (error) {
      expectStatus(error, 409);
    }
    expect(prisma.school.create).not.toHaveBeenCalled();
  });

  it('rejects an expired reset code', async () => {
    prisma.authCode.findFirst.mockResolvedValue({
      id: 'code-1',
      email: 'admin@demo.school',
      used_at: null,
      expires_at: new Date(Date.now() - 1000),
    });

    try {
      await service.resetPassword({
        token: '453210',
        password: 'password2',
        confirmPassword: 'password2',
      });
      throw new Error('expected bad request');
    } catch (error) {
      expectStatus(error, 400);
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('returns 401 from me when the user does not exist', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    try {
      await service.me('missing');
      throw new Error('expected unauthorized');
    } catch (error) {
      expectStatus(error, 401);
    }
  });

  const activeClassCode = {
    id: 'code-1',
    code: 'WING-4320',
    status: 'ACTIVE',
    expires_at: null,
    class: {
      id: 'class-1',
      name: 'Grade 4 · Amber',
      school_id: 'school-1',
      teacher: { real_name: 'Ada Teacher', nickname: null },
    },
  };

  const studentRegister = {
    code: 'WING-4320',
    username: 'wingkid',
    password: 'password1',
    confirmPassword: 'password1',
    nickname: 'Wing',
    realName: 'Wing Kid',
  };

  it('returns 404 WRONG_CODE when the class code is unknown', async () => {
    prisma.classCode.findFirst.mockResolvedValue(null);

    try {
      await service.joinCode({ code: 'NOPE' });
      throw new Error('expected not found');
    } catch (error) {
      expectStatus(error, 404);
      expect((error as HttpException).getResponse()).toBe('WRONG_CODE');
    }
  });

  it('returns 422 EXPIRED_CODE when the class code is expired', async () => {
    prisma.classCode.findFirst.mockResolvedValue({
      ...activeClassCode,
      status: 'EXPIRED',
    });

    try {
      await service.joinCode({ code: 'WING-4320' });
      throw new Error('expected expired');
    } catch (error) {
      expectStatus(error, 422);
      expect((error as HttpException).getResponse()).toBe('EXPIRED_CODE');
    }
  });

  it('returns the class name for an active code', async () => {
    prisma.classCode.findFirst.mockResolvedValue(activeClassCode);

    const result = await service.joinCode({ code: 'WING-4320' });

    expect(result.data).toEqual({
      className: 'Grade 4 · Amber',
      teacherName: 'Ada Teacher',
      classId: 'class-1',
    });
  });

  it('registers a pending student and a pending membership', async () => {
    prisma.classCode.findFirst.mockResolvedValue(activeClassCode);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }) => ({
      id: 'student-1',
      email: null,
      school_id: data.school_id,
      ...data,
    }));

    const result = await service.registerStudent(studentRegister);

    const created = prisma.user.create.mock.calls[0][0].data;
    expect(created.role).toBe(Role.STUDENT);
    expect(created.status).toBe(UserStatus.PENDING);
    expect(created.school_id).toBe('school-1');
    expect(created.username).toBe('wingkid');
    expect(created.password_hash).not.toBe(studentRegister.password);
    await expect(
      bcrypt.compare(studentRegister.password, created.password_hash),
    ).resolves.toBe(true);
    expect(prisma.classMembership.create).toHaveBeenCalledWith({
      data: {
        class_id: 'class-1',
        user_id: 'student-1',
        status: 'PENDING',
        joined_via_code_id: 'code-1',
      },
    });
    expect(result.data.accessToken).toBe('token');
    expect(result.data.user.status).toBe(UserStatus.PENDING);
  });

  it('rejects a duplicate student username', async () => {
    prisma.classCode.findFirst.mockResolvedValue(activeClassCode);
    prisma.user.findFirst.mockResolvedValue({ id: 'student-1' });

    try {
      await service.registerStudent(studentRegister);
      throw new Error('expected conflict');
    } catch (error) {
      expectStatus(error, 409);
    }
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects a locked hero', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'student-1',
      role: Role.STUDENT,
    });
    prisma.hero.findFirst.mockResolvedValue({
      id: 'hero-2',
      unlock_stories_required: 2,
    });
    prisma.studentHeroUnlock.findFirst.mockResolvedValue(null);

    try {
      await service.selectHero('student-1', { heroId: 'hero-2' });
      throw new Error('expected forbidden');
    } catch (error) {
      expectStatus(error, 403);
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.studentHeroUnlock.create).not.toHaveBeenCalled();
  });

  it('rejects student login while the account is pending', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'student-1',
      role: Role.STUDENT,
      status: UserStatus.PENDING,
      password_hash: await bcrypt.hash('password1', 4),
    });

    try {
      await service.loginStudent({
        username: 'wingkid',
        password: 'password1',
      });
      throw new Error('expected pending');
    } catch (error) {
      expectStatus(error, 422);
      expect(String((error as HttpException).getResponse())).toContain(
        'PENDING',
      );
    }
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('returns a token for an active student', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'student-1',
      email: null,
      username: 'wingkid',
      role: Role.STUDENT,
      status: UserStatus.ACTIVE,
      real_name: 'Wing Kid',
      nickname: 'Wing',
      school_id: 'school-1',
      password_hash: await bcrypt.hash('password1', 4),
    });

    const result = await service.loginStudent({
      username: 'wingkid',
      password: 'password1',
      remember: true,
    });

    expect(result.data.accessToken).toBe('token');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'student-1',
        role: Role.STUDENT,
        status: UserStatus.ACTIVE,
      }),
    );
  });

  it('does not log in a staff account by email on the student route', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    try {
      await service.loginStudent({
        username: 'teacher@demo.school',
        password: 'password1',
      });
      throw new Error('expected unauthorized');
    } catch (error) {
      expectStatus(error, 401);
    }
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { username: 'teacher@demo.school' },
    });
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  const inviteDto = {
    token: 'invite-token',
    password: 'password1',
    confirmPassword: 'password1',
    name: 'Ada Teacher',
  };

  function openInvite() {
    return {
      id: 'invite-1',
      email: 'teacher@demo.school',
      token_hash: hashCode('invite-token'),
      accepted_at: null,
      expires_at: new Date(Date.now() + 60_000),
      can_access_safe_space: true,
      invited_by: { school_id: 'school-1' },
    };
  }

  it('rejects an invite token that does not match', async () => {
    prisma.staffInvite.findFirst.mockResolvedValue(null);

    try {
      await service.acceptInvite(inviteDto);
      throw new Error('expected bad request');
    } catch (error) {
      expectStatus(error, 400);
    }
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates an active teacher and marks the invite accepted', async () => {
    prisma.staffInvite.findFirst.mockResolvedValue(openInvite());
    prisma.user.create.mockImplementation(async ({ data }) => ({
      id: 'teacher-1',
      username: null,
      nickname: null,
      ...data,
    }));

    const result = await service.acceptInvite(inviteDto);

    const created = prisma.user.create.mock.calls[0][0].data;
    expect(created.role).toBe(Role.TEACHER);
    expect(created.status).toBe(UserStatus.ACTIVE);
    expect(created.school_id).toBe('school-1');
    expect(created.email).toBe('teacher@demo.school');
    expect(created.settings_json).toEqual({ canAccessSafeSpace: true });
    expect(created.password_hash).not.toBe(inviteDto.password);
    expect(prisma.staffInvite.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: { accepted_at: expect.any(Date) },
    });
    expect(result.data.user.role).toBe(Role.TEACHER);
    expect(result.data).not.toHaveProperty('accessToken');
  });

  it('rejects a second accept of the same invite', async () => {
    prisma.staffInvite.findFirst.mockResolvedValue({
      ...openInvite(),
      accepted_at: new Date(),
    });

    try {
      await service.acceptInvite(inviteDto);
      throw new Error('expected bad request');
    } catch (error) {
      expectStatus(error, 400);
    }
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  describe('studentForgotPassword', () => {
    it('unknown username still returns success and does not throw', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.studentForgotPassword({
        username: 'ghost_student',
      });

      expect(result).toEqual({ success: true });
      expect(prisma.authCode.create).not.toHaveBeenCalled();
      expect(mail.sendOtpCodeToEmail).not.toHaveBeenCalled();
    });

    it('known student with an email creates one AuthCode', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'student-1',
        username: 'wingkid',
        real_name: 'Wing Kid',
        nickname: 'Wing',
        role: Role.STUDENT,
        email: 'wingkid@school.demo',
      });
      prisma.authCode.create.mockResolvedValue({ id: 'code-1' });

      const result = await service.studentForgotPassword({
        username: 'wingkid',
      });

      expect(result).toEqual({ success: true });
      expect(prisma.authCode.create).toHaveBeenCalledTimes(1);
      const codeData = prisma.authCode.create.mock.calls[0][0].data;
      expect(codeData.email).toBe('wingkid@school.demo');
      expect(codeData.purpose).toBe(AuthCodePurpose.RESET_PASSWORD);
      expect(codeData.expires_at.getTime()).toBeGreaterThan(
        Date.now() + 14 * 60 * 1000,
      );
      expect(codeData.expires_at.getTime()).toBeLessThan(
        Date.now() + 16 * 60 * 1000,
      );
      expect(mail.sendOtpCodeToEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'wingkid@school.demo',
        }),
      );
    });

    it('known student without an email returns success and creates no code', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'student-2',
        username: 'noemailkid',
        real_name: 'No Email Kid',
        nickname: 'NoEmail',
        role: Role.STUDENT,
        email: null,
      });

      const result = await service.studentForgotPassword({
        username: 'noemailkid',
      });

      expect(result).toEqual({ success: true });
      expect(prisma.authCode.create).not.toHaveBeenCalled();
      expect(mail.sendOtpCodeToEmail).not.toHaveBeenCalled();
    });

    it('response does not include the code', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'student-1',
        username: 'wingkid',
        real_name: 'Wing Kid',
        nickname: 'Wing',
        role: Role.STUDENT,
        email: 'wingkid@school.demo',
      });
      prisma.authCode.create.mockResolvedValue({ id: 'code-1' });

      const result = await service.studentForgotPassword({
        username: 'wingkid',
      });

      expect(result).toEqual({ success: true });
      expect(result).not.toHaveProperty('code');
      expect(result).not.toHaveProperty('otp');
      expect(result).not.toHaveProperty('data');
    });

    it('missing username still returns success and does not throw', async () => {
      const result = await service.studentForgotPassword({} as any);

      expect(result).toEqual({ success: true });
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.authCode.create).not.toHaveBeenCalled();
    });

    it('does not create code if user is not a student', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'teacher-1',
        username: 'teach1',
        real_name: 'Teach',
        role: Role.TEACHER,
        email: 'teach@school.demo',
      });

      const result = await service.studentForgotPassword({
        username: 'teach1',
      });

      expect(result).toEqual({ success: true });
      expect(prisma.authCode.create).not.toHaveBeenCalled();
      expect(mail.sendOtpCodeToEmail).not.toHaveBeenCalled();
    });
  });
});
