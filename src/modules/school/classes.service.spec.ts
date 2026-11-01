import { HttpException } from '@nestjs/common';
import {
  AgeGroup,
  ClassCodeStatus,
  JoinRequestStatus,
  RenewalRequestStatus,
  Role,
} from 'prisma/generated/client';
import { paginateResponse } from '../../common/pagination/pagination.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassesService } from './classes.service';

describe('ClassesService', () => {
  const prisma = {
    class: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    classCode: {
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    classMembership: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
    },
    classCreationRequest: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    classCodeRenewalRequest: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      update: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const service = new ClassesService(prisma as unknown as PrismaService);

  const amber = {
    id: 'class-1',
    name: 'Grade 4 · Amber',
    grade_label: 'Grade 4',
    age_group: 'AGE_6_9',
    teacher_id: 'teacher-1',
  };

  const admin = {
    id: 'admin-1',
    role: Role.ADMIN,
    school_id: 'school-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findFirst.mockReset();
    prisma.classCode.create.mockReset();
    prisma.classCode.updateMany.mockReset();
    prisma.classCode.findMany.mockResolvedValue([]);
    prisma.classMembership.groupBy.mockResolvedValue([]);
  });

  it('lists only the caller’s classes', async () => {
    prisma.class.count.mockResolvedValue(1);
    prisma.class.findMany.mockResolvedValue([amber]);

    const result = await service.list('teacher-1', { page: 1, perPage: 10 });

    expect(prisma.class.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { teacher_id: 'teacher-1' } }),
    );
    expect(result.data.items).toEqual([
      expect.objectContaining({ id: 'class-1', name: 'Grade 4 · Amber' }),
    ]);
    expect(result.data.items).toHaveLength(1);
  });

  it('lists pending memberships for that class', async () => {
    prisma.class.findFirst.mockResolvedValue(amber);
    prisma.classMembership.count.mockResolvedValue(1);
    prisma.classMembership.findMany.mockResolvedValue([
      {
        id: 'mem-1',
        status: JoinRequestStatus.PENDING,
        created_at: new Date('2026-10-31T00:00:00.000Z'),
        user: {
          id: 'student-1',
          username: 'mina',
          nickname: 'Mina',
          real_name: 'Mina Kapoor',
          status: 'PENDING',
        },
      },
    ]);

    const result = await service.joinRequests('teacher-1', 'class-1', {
      page: 1,
      perPage: 10,
    });

    expect(prisma.classMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { class_id: 'class-1', status: JoinRequestStatus.PENDING },
      }),
    );
    expect(result.data.items[0].student.realName).toBe('Mina Kapoor');
  });

  it('approves a pending membership without activating the user', async () => {
    prisma.classMembership.findFirst.mockResolvedValue({
      id: 'mem-1',
      status: JoinRequestStatus.PENDING,
      class: amber,
    });
    prisma.classMembership.update.mockResolvedValue({
      id: 'mem-1',
      status: JoinRequestStatus.APPROVED,
    });

    const result = await service.approve('teacher-1', 'mem-1');

    expect(prisma.classMembership.update).toHaveBeenCalledWith({
      where: { id: 'mem-1' },
      data: {
        status: JoinRequestStatus.APPROVED,
        approved_by_id: 'teacher-1',
        approved_at: expect.any(Date),
      },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(result.data.status).toBe(JoinRequestStatus.APPROVED);
  });

  it('rejects a pending membership', async () => {
    prisma.classMembership.findFirst.mockResolvedValue({
      id: 'mem-1',
      status: JoinRequestStatus.PENDING,
      class: amber,
    });
    prisma.classMembership.update.mockResolvedValue({
      id: 'mem-1',
      status: JoinRequestStatus.REJECTED,
    });

    const result = await service.reject('teacher-1', 'mem-1');

    expect(prisma.classMembership.update).toHaveBeenCalledWith({
      where: { id: 'mem-1' },
      data: { status: JoinRequestStatus.REJECTED },
    });
    expect(result.data.status).toBe(JoinRequestStatus.REJECTED);
  });

  it('forbids approving a class the teacher does not own', async () => {
    prisma.classMembership.findFirst.mockResolvedValue({
      id: 'mem-1',
      status: JoinRequestStatus.PENDING,
      class: { ...amber, teacher_id: 'teacher-2' },
    });

    try {
      await service.approve('teacher-1', 'mem-1');
      throw new Error('expected forbidden');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
    }
    expect(prisma.classMembership.update).not.toHaveBeenCalled();
  });

  it('sets lastPage to ceil(total / perPage)', () => {
    expect(paginateResponse([], 0, 1, 10).lastPage).toBe(0);
    expect(paginateResponse([], 10, 1, 10).lastPage).toBe(1);
    expect(paginateResponse([], 25, 2, 10).lastPage).toBe(3);
  });

  it('create returns a unique active code', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(admin).mockResolvedValueOnce({
      id: 'teacher-1',
      role: Role.TEACHER,
      school_id: 'school-1',
    });
    prisma.class.create.mockResolvedValue({
      id: 'class-2',
      name: 'Grade 4 · Amber',
      grade_label: 'Grade 4',
      age_group: AgeGroup.AGE_6_9,
    });
    prisma.classCode.create.mockImplementation(async ({ data }) => ({
      id: 'code-1',
      expires_at: null,
      ...data,
    }));

    const result = await service.createClass('admin-1', {
      name: 'Grade 4 · Amber',
      grade: 'Grade 4',
      ageGroup: AgeGroup.AGE_6_9,
      teacherId: 'teacher-1',
    });

    const created = prisma.classCode.create.mock.calls[0][0].data;
    expect(created.code).toMatch(/^WING-\d{4}$/);
    expect(created.status).toBe(ClassCodeStatus.ACTIVE);
    expect(result.data.code).toBe(created.code);
  });

  it('regenerate revokes the previous active code', async () => {
    prisma.user.findFirst.mockResolvedValue(admin);
    prisma.class.findFirst.mockResolvedValue({
      ...amber,
      school_id: 'school-1',
    });
    prisma.classCode.updateMany.mockResolvedValue({ count: 1 });
    prisma.classCode.create.mockImplementation(async ({ data }) => ({
      id: 'code-2',
      expires_at: null,
      ...data,
    }));

    await service.regenerateCode('admin-1', 'class-1');

    expect(prisma.classCode.updateMany).toHaveBeenCalledWith({
      where: { class_id: 'class-1', status: ClassCodeStatus.ACTIVE },
      data: { status: ClassCodeStatus.REVOKED },
    });
    expect(prisma.classCode.create).toHaveBeenCalledTimes(1);
    expect(prisma.classCode.create.mock.calls[0][0].data.status).toBe(
      ClassCodeStatus.ACTIVE,
    );
  });

  it('change-teacher rejects a teacher from another school', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(admin).mockResolvedValueOnce({
      id: 'teacher-9',
      role: Role.TEACHER,
      school_id: 'school-2',
    });
    prisma.class.findFirst.mockResolvedValue({
      ...amber,
      school_id: 'school-1',
    });

    try {
      await service.changeTeacher('admin-1', 'class-1', {
        teacherId: 'teacher-9',
      });
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(422);
    }
    expect(prisma.class.update).not.toHaveBeenCalled();
  });

  it('approve creation persists resulting_class_id', async () => {
    prisma.user.findFirst.mockResolvedValue(admin);
    prisma.classCreationRequest.findFirst.mockResolvedValue({
      id: 'req-1',
      school_id: 'school-1',
      status: RenewalRequestStatus.PENDING,
      payload_json: {
        name: 'Grade 5 · Birch',
        grade: 'Grade 5',
        age_group: AgeGroup.AGE_10_13,
      },
    });
    prisma.class.create.mockResolvedValue({
      id: 'class-9',
      name: 'Grade 5 · Birch',
      grade_label: 'Grade 5',
      age_group: AgeGroup.AGE_10_13,
    });
    prisma.classCode.create.mockImplementation(async ({ data }) => ({
      id: 'code-9',
      expires_at: null,
      ...data,
    }));
    prisma.classCreationRequest.update.mockResolvedValue({});

    const result = await service.approveCreation('admin-1', 'req-1');

    expect(prisma.classCreationRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: {
        status: RenewalRequestStatus.APPROVED,
        resulting_class_id: 'class-9',
      },
    });
    expect(result.data.resultingClassId).toBe('class-9');
  });

  it('renewal approve sets new_code_id and leaves one active code', async () => {
    prisma.user.findFirst.mockResolvedValue(admin);
    prisma.classCodeRenewalRequest.findFirst.mockResolvedValue({
      id: 'ren-1',
      status: RenewalRequestStatus.PENDING,
      class_id: 'class-1',
      class: { id: 'class-1', school_id: 'school-1' },
    });
    prisma.classCode.updateMany.mockResolvedValue({ count: 1 });
    prisma.classCode.create.mockImplementation(async ({ data }) => ({
      id: 'code-new',
      expires_at: null,
      ...data,
    }));
    prisma.classCodeRenewalRequest.update.mockResolvedValue({});

    const result = await service.approveRenewal('admin-1', 'ren-1');

    expect(prisma.classCode.updateMany).toHaveBeenCalledWith({
      where: { class_id: 'class-1', status: ClassCodeStatus.ACTIVE },
      data: { status: ClassCodeStatus.REVOKED },
    });
    expect(prisma.classCode.create).toHaveBeenCalledTimes(1);
    expect(prisma.classCode.create.mock.calls[0][0].data.status).toBe(
      ClassCodeStatus.ACTIVE,
    );
    expect(prisma.classCodeRenewalRequest.update).toHaveBeenCalledWith({
      where: { id: 'ren-1' },
      data: {
        status: RenewalRequestStatus.APPROVED,
        resolved_by_id: 'admin-1',
        new_code_id: 'code-new',
      },
    });
    expect(result.data.newCodeId).toBe('code-new');
  });

  it('teacher cannot file a renewal for another teacher’s class', async () => {
    prisma.class.findFirst.mockResolvedValue({
      ...amber,
      teacher_id: 'teacher-2',
    });

    try {
      await service.requestRenewal('teacher-1', 'class-1', {});
      throw new Error('expected forbidden');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
    }
    expect(prisma.classCodeRenewalRequest.create).not.toHaveBeenCalled();
  });
});
