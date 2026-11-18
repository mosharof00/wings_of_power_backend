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
      create: jest.fn(),
      update: jest.fn(),
    },
    class: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    staffInvite: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const mail = {
    sendMemberInvitation: jest.fn(),
    sendStaffInviteCredentials: jest.fn(),
  };
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
    mail.sendStaffInviteCredentials.mockResolvedValue(undefined);
  });

  it('invite creates an active teacher and emails credentials', async () => {
    prisma.user.findFirst
      .mockResolvedValueOnce(admin)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'teacher-1',
        email: 'teacher@school.edu',
        username: null,
        real_name: 'Ada Teacher',
        role: Role.TEACHER,
        status: UserStatus.INVITED,
        settings_json: { canAccessSafeSpace: true },
        created_at: new Date('2026-01-01'),
        classes_teaching: [],
      });
    prisma.user.create.mockResolvedValue({
      id: 'teacher-1',
      email: 'teacher@school.edu',
    });
    prisma.staffInvite.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.invite('admin-1', {
      name: 'Ada Teacher',
      email: 'Teacher@School.edu',
      temporaryPassword: 'TempPass1!',
      canAccessSafeSpace: true,
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'teacher@school.edu',
          real_name: 'Ada Teacher',
          role: Role.TEACHER,
          status: UserStatus.INVITED,
          school_id: 'school-1',
        }),
      }),
    );
    expect(mail.sendStaffInviteCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'teacher@school.edu',
        name: 'Ada Teacher',
        temporaryPassword: 'TempPass1!',
        signInUrl: expect.stringContaining('/sign-in'),
      }),
    );
    expect(result.data.email).toBe('teacher@school.edu');
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
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    const context = {
      getHandler: () => AdminStaffController.prototype.list,
      getClass: () => AdminStaffController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: 'teacher-1' } }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});
