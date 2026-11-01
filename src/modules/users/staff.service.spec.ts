import { createHash } from 'crypto';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, UserStatus } from 'prisma/generated/client';
import { UserRepository } from '../../common/repository/user/user.repository';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminStaffController } from './admin-staff.controller';
import { StaffService } from './staff.service';

describe('StaffService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    staffInvite: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
  const mail = { sendMemberInvitation: jest.fn() };
  const service = new StaffService(
    prisma as unknown as PrismaService,
    mail as unknown as MailService,
  );

  const admin = {
    id: 'admin-1',
    role: Role.ADMIN,
    school_id: 'school-1',
    real_name: 'Sarah Admin',
    email: 'admin@school.edu',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findFirst.mockReset();
    mail.sendMemberInvitation.mockResolvedValue(undefined);
  });

  it('invite stores a hash, not the raw token, and sets can_access_safe_space', async () => {
    prisma.user.findFirst
      .mockResolvedValueOnce(admin)
      .mockResolvedValueOnce(null);
    prisma.staffInvite.findFirst.mockResolvedValue(null);
    prisma.staffInvite.create.mockImplementation(async ({ data }) => ({
      id: 'invite-1',
      ...data,
    }));

    const result = await service.invite('admin-1', {
      email: 'Teacher@School.edu',
      canAccessSafeSpace: true,
    });

    const stored = prisma.staffInvite.create.mock.calls[0][0].data;
    expect(stored.can_access_safe_space).toBe(true);
    expect(stored.email).toBe('teacher@school.edu');
    expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.token_hash).not.toBe(result.data.devToken);
    expect(
      createHash('sha256').update(result.data.devToken).digest('hex'),
    ).toBe(stored.token_hash);
    expect(mail.sendMemberInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        member: expect.objectContaining({ token: result.data.devToken }),
      }),
    );
    const expiresIn = stored.expires_at.getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(expiresIn).toBeLessThan(8 * 24 * 60 * 60 * 1000);
  });

  it('reactivates inactive staff and conflicts when already active', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(admin).mockResolvedValueOnce({
      id: 'teacher-1',
      role: Role.TEACHER,
      status: UserStatus.INACTIVE,
      school_id: 'school-1',
      classes_teaching: [],
    });
    prisma.user.update.mockResolvedValue({
      id: 'teacher-1',
      status: UserStatus.ACTIVE,
    });

    const result = await service.reactivate('admin-1', 'teacher-1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'teacher-1' },
      data: { status: UserStatus.ACTIVE },
    });
    expect(result.data.status).toBe(UserStatus.ACTIVE);

    prisma.user.findFirst.mockResolvedValueOnce(admin).mockResolvedValueOnce({
      id: 'teacher-1',
      role: Role.TEACHER,
      status: UserStatus.ACTIVE,
      school_id: 'school-1',
      classes_teaching: [],
    });
    try {
      await service.reactivate('admin-1', 'teacher-1');
      throw new Error('expected conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(409);
    }
  });

  it('teacher cannot read admin staff', async () => {
    const reflector = new Reflector();
    const users = {
      getUserDetails: jest.fn().mockResolvedValue({ role: Role.TEACHER }),
    };
    const guard = new RolesGuard(reflector, users as unknown as UserRepository);
    const context = {
      getHandler: () => AdminStaffController.prototype.list,
      getClass: () => AdminStaffController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: 'teacher-1' } }),
      }),
    } as unknown as ExecutionContext;

    try {
      await guard.canActivate(context);
      throw new Error('expected forbidden');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
    }
  });
});
