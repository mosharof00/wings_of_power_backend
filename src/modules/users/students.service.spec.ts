import { HttpException } from '@nestjs/common';
import { JoinRequestStatus, Role, UserStatus } from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StudentsService } from './students.service';

describe('StudentsService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    class: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    classMembership: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const service = new StudentsService(prisma as unknown as PrismaService);

  const admin = {
    id: 'admin-1',
    role: Role.ADMIN,
    school_id: 'school-1',
  };
  const teacher = {
    id: 'teacher-1',
    role: Role.TEACHER,
    school_id: 'school-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findFirst.mockReset();
    prisma.classMembership.update.mockReset();
    prisma.classMembership.create.mockReset();
  });

  it('admin list filters by status and hides soft-deleted users', async () => {
    prisma.user.findFirst.mockResolvedValue(admin);
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);

    await service.adminList('admin-1', {
      status: UserStatus.PENDING,
      page: 1,
      perPage: 10,
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deleted_at: null,
          role: Role.STUDENT,
          school_id: 'school-1',
          status: UserStatus.PENDING,
        }),
      }),
    );
  });

  it('approve sets ACTIVE and does not change membership status', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(admin).mockResolvedValueOnce({
      id: 'student-1',
      role: Role.STUDENT,
      status: UserStatus.PENDING,
      school_id: 'school-1',
      memberships: [
        {
          id: 'mem-1',
          class_id: 'class-1',
          status: JoinRequestStatus.PENDING,
          class: { id: 'class-1', name: 'Amber', teacher_id: 'teacher-1' },
        },
      ],
    });
    prisma.user.update.mockResolvedValue({
      id: 'student-1',
      status: UserStatus.ACTIVE,
    });

    const result = await service.approve('admin-1', 'student-1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'student-1' },
      data: { status: UserStatus.ACTIVE },
    });
    expect(prisma.classMembership.update).not.toHaveBeenCalled();
    expect(prisma.classMembership.create).not.toHaveBeenCalled();
    expect(result.data.status).toBe(UserStatus.ACTIVE);
  });

  it('move-class rejects a class in another school', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(admin).mockResolvedValueOnce({
      id: 'student-1',
      role: Role.STUDENT,
      school_id: 'school-1',
      memberships: [],
    });
    prisma.class.findFirst.mockResolvedValue({
      id: 'class-9',
      school_id: 'school-2',
    });

    try {
      await service.moveClass('admin-1', 'student-1', { classId: 'class-9' });
      throw new Error('expected forbidden');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
    }
    expect(prisma.classMembership.create).not.toHaveBeenCalled();
    expect(prisma.classMembership.update).not.toHaveBeenCalled();
  });

  it('teacher roster excludes other teachers’ students', async () => {
    prisma.user.findFirst.mockResolvedValue(teacher);
    prisma.class.findMany.mockResolvedValue([{ id: 'class-1' }]);
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);

    await service.teacherList('teacher-1', { page: 1, perPage: 10 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: Role.STUDENT,
          deleted_at: null,
          memberships: { some: { class_id: { in: ['class-1'] } } },
        }),
      }),
    );
  });

  it('teacher detail for an outside student is 403', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(teacher).mockResolvedValueOnce({
      id: 'student-2',
      role: Role.STUDENT,
      school_id: 'school-1',
      memberships: [
        {
          id: 'mem-2',
          class_id: 'class-9',
          status: JoinRequestStatus.APPROVED,
          class: { id: 'class-9', name: 'Other', teacher_id: 'teacher-2' },
        },
      ],
    });

    try {
      await service.teacherDetail('teacher-1', 'student-2');
      throw new Error('expected forbidden');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
    }
  });
});
