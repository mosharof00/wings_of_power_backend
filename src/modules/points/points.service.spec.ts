import { HttpException } from '@nestjs/common';
import { JoinRequestStatus, PointsSource, Role } from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService } from './points.service';

describe('PointsService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    classMembership: {
      findFirst: jest.fn(),
    },
    pointRule: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    pointsLedger: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    badge: {
      count: jest.fn(),
    },
  };

  const service = new PointsService(prisma as unknown as PrismaService);

  const teacher = {
    id: 'teacher-1',
    role: Role.TEACHER,
    school_id: 'school-1',
  };

  const admin = {
    id: 'admin-1',
    role: Role.ADMIN,
    school_id: 'school-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('awardPoints', () => {
    it('award of 0 or negative → 400', async () => {
      await expect(
        service.awardPoints('teacher-1', {
          studentId: 'student-1',
          amount: 0,
          category: 'Kindness',
        }),
      ).rejects.toMatchObject({
        status: 400,
      });

      await expect(
        service.awardPoints('teacher-1', {
          studentId: 'student-1',
          amount: -5,
          category: 'Kindness',
        }),
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('award for a student outside the teacher’s classes → 403', async () => {
      prisma.user.findFirst.mockResolvedValue(teacher);
      prisma.classMembership.findFirst.mockResolvedValue(null);

      try {
        await service.awardPoints('teacher-1', {
          studentId: 'student-outside',
          amount: 3,
          category: 'Teamwork',
        });
        throw new Error('expected forbidden');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(403);
      }
    });

    it('award above the max → 422 (default max is 5)', async () => {
      prisma.user.findFirst.mockResolvedValue(teacher);
      prisma.classMembership.findFirst.mockResolvedValue({
        id: 'mem-1',
        user_id: 'student-1',
        class_id: 'class-1',
        status: JoinRequestStatus.APPROVED,
      });
      // No custom PointRule exists
      prisma.pointRule.findFirst.mockResolvedValue(null);

      try {
        await service.awardPoints('teacher-1', {
          studentId: 'student-1',
          amount: 6,
          category: 'Kindness',
        });
        throw new Error('expected unprocessable entity');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(422);
      }
    });

    it('award above custom TEACHER_AWARD_MAX → 422', async () => {
      prisma.user.findFirst.mockResolvedValue(teacher);
      prisma.classMembership.findFirst.mockResolvedValue({
        id: 'mem-1',
        user_id: 'student-1',
        class_id: 'class-1',
        status: JoinRequestStatus.APPROVED,
      });
      // Custom PointRule exists with value 10
      prisma.pointRule.findFirst.mockResolvedValue({
        id: 'rule-1',
        school_id: 'school-1',
        key: 'TEACHER_AWARD_MAX',
        value_int: 10,
      });

      try {
        await service.awardPoints('teacher-1', {
          studentId: 'student-1',
          amount: 11,
          category: 'Kindness',
        });
        throw new Error('expected unprocessable entity');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(422);
      }
    });

    it('ledger row has kindness_amount 0', async () => {
      prisma.user.findFirst.mockResolvedValue(teacher);
      prisma.classMembership.findFirst.mockResolvedValue({
        id: 'mem-1',
        user_id: 'student-1',
        class_id: 'class-1',
        status: JoinRequestStatus.APPROVED,
      });
      prisma.pointRule.findFirst.mockResolvedValue(null);

      const createdLedger = {
        id: 'ledger-1',
        user_id: 'student-1',
        source: PointsSource.TEACHER_AWARD,
        amount: 4,
        kindness_amount: 0,
        label: 'Helping Classmate',
        ref_type: 'TeacherAward',
        ref_id: 'Helped clean up the desk',
        awarded_by_id: 'teacher-1',
      };
      prisma.pointsLedger.create.mockResolvedValue(createdLedger);

      const result = await service.awardPoints('teacher-1', {
        studentId: 'student-1',
        amount: 4,
        category: 'Helping Classmate',
        reason: 'Helped clean up the desk',
      });

      expect(prisma.pointsLedger.create).toHaveBeenCalledWith({
        data: {
          user_id: 'student-1',
          source: PointsSource.TEACHER_AWARD,
          amount: 4,
          kindness_amount: 0,
          label: 'Helping Classmate',
          ref_type: 'TeacherAward',
          ref_id: 'Helped clean up the desk',
          awarded_by_id: 'teacher-1',
        },
      });

      expect(result.success).toBe(true);
      expect(result.data.kindness_amount).toBe(0);
    });
  });

  describe('patchPointRules', () => {
    it('patch rejects an unknown key with 400', async () => {
      prisma.user.findFirst.mockResolvedValue(admin);

      await expect(
        service.patchPointRules('admin-1', {
          UNKNOWN_KEY: 10,
        }),
      ).rejects.toMatchObject({
        status: 400,
      });

      await expect(
        service.patchPointRules('admin-1', {
          invalidRule: 5,
        }),
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('patch rejects negative values with 400', async () => {
      prisma.user.findFirst.mockResolvedValue(admin);

      await expect(
        service.patchPointRules('admin-1', {
          STORY_QUESTION: -1,
        }),
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('patch rejects empty body with 400', async () => {
      prisma.user.findFirst.mockResolvedValue(admin);

      await expect(
        service.patchPointRules('admin-1', {}),
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('creates missing rule row or updates existing row', async () => {
      prisma.user.findFirst.mockResolvedValue(admin);
      // Existing STORY_QUESTION rule
      prisma.pointRule.findFirst
        .mockResolvedValueOnce({
          id: 'rule-sq',
          school_id: 'school-1',
          key: 'STORY_QUESTION',
          value_int: 1,
        })
        // Missing TEACHER_AWARD_MAX rule
        .mockResolvedValueOnce(null);

      prisma.pointRule.findMany.mockResolvedValue([
        { id: 'rule-sq', key: 'STORY_QUESTION', value_int: 3 },
        { id: 'rule-ta', key: 'TEACHER_AWARD_MAX', value_int: 8 },
      ]);
      prisma.pointsLedger.aggregate.mockResolvedValue({
        _sum: { amount: 100, kindness_amount: 200 },
      });
      prisma.badge.count.mockResolvedValue(6);

      const result = await service.patchPointRules('admin-1', {
        STORY_QUESTION: 3,
        teacherAward: 8,
      });

      expect(prisma.pointRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-sq' },
        data: { value_int: 3 },
      });

      expect(prisma.pointRule.create).toHaveBeenCalledWith({
        data: {
          school_id: 'school-1',
          key: 'TEACHER_AWARD_MAX',
          value_int: 8,
        },
      });

      expect(result.success).toBe(true);
      expect(result.data.rules.storyPoints).toBe(3);
      expect(result.data.rules.teacherAward).toBe(8);
    });
  });

  describe('getStudentPoints', () => {
    it('student list is only that student’s rows and includes today sum', async () => {
      const studentId = 'student-1';
      prisma.pointsLedger.findMany.mockResolvedValue([
        {
          id: 'ledger-1',
          user_id: studentId,
          amount: 5,
          kindness_amount: 0,
          source: PointsSource.STORY_QUIZ,
          created_at: new Date(),
        },
      ]);
      prisma.pointsLedger.count.mockResolvedValue(1);
      prisma.pointsLedger.aggregate.mockResolvedValue({
        _sum: { amount: 5 },
      });

      const result = await service.getStudentPoints(studentId, {
        page: 1,
        perPage: 10,
      });

      expect(prisma.pointsLedger.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: studentId },
          skip: 0,
          take: 10,
        }),
      );

      expect(prisma.pointsLedger.count).toHaveBeenCalledWith({
        where: { user_id: studentId },
      });

      expect(prisma.pointsLedger.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: studentId,
            created_at: expect.objectContaining({
              gte: expect.any(Date),
            }),
          }),
          _sum: { amount: true },
        }),
      );

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(1);
      expect(result.data.today).toBe(5);
    });
  });

  describe('getTeacherHistory', () => {
    it('returns paginated awards issued by this teacher', async () => {
      prisma.pointsLedger.findMany.mockResolvedValue([
        {
          id: 'ledger-1',
          user_id: 'student-1',
          amount: 5,
          label: 'Kindness',
          ref_id: 'Helped friend',
          awarded_by_id: 'teacher-1',
          created_at: new Date(),
          user: {
            id: 'student-1',
            real_name: 'Alice Smith',
            nickname: 'Alice',
            username: 'alice',
          },
        },
      ]);
      prisma.pointsLedger.count.mockResolvedValue(1);

      const result = await service.getTeacherHistory('teacher-1', {
        page: 1,
        perPage: 10,
      });

      expect(prisma.pointsLedger.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            awarded_by_id: 'teacher-1',
            source: PointsSource.TEACHER_AWARD,
          },
        }),
      );

      expect(result.success).toBe(true);
      expect(result.data.items[0].studentName).toBe('Alice Smith');
      expect(result.data.items[0].points).toBe(5);
    });
  });

  describe('getPointRules', () => {
    it('returns summary metrics and defaults when no rules configured', async () => {
      prisma.user.findFirst.mockResolvedValue(admin);
      prisma.pointRule.findMany.mockResolvedValue([]);
      prisma.pointsLedger.aggregate.mockResolvedValue({
        _sum: { amount: 1500, kindness_amount: 3000 },
      });
      prisma.badge.count.mockResolvedValue(6);

      const result = await service.getPointRules('admin-1');

      expect(result.success).toBe(true);
      expect(result.data.summary.totalPositivePoints).toBe(1500);
      expect(result.data.summary.totalKindnessPoints).toBe(3000);
      expect(result.data.summary.totalBadges).toBe(6);
      expect(result.data.rules.storyPoints).toBe(1);
      expect(result.data.rules.kindnessPoints).toBe(50);
      expect(result.data.rules.teacherAward).toBe(5);
    });
  });
});
