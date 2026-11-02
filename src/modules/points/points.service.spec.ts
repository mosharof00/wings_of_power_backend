import { HttpException } from '@nestjs/common';
import {
  JoinRequestStatus,
  PointsSource,
  Role,
  UserStatus,
} from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LeaderboardScope } from './dto/leaderboard.dto';
import { PointsService } from './points.service';

describe('PointsService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    classMembership: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
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
      groupBy: jest.fn(),
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

  describe('getLeaderboard', () => {
    const student1 = {
      id: 'student-1',
      role: Role.STUDENT,
      status: UserStatus.ACTIVE,
      nickname: 'HeroKid',
      username: 'student1',
      avatar_url: 'https://cdn.example.com/a1.png',
      real_name: 'John Doe',
      selected_hero_id: 'hero-1',
      school_id: 'school-1',
      deleted_at: null,
    };

    const student2 = {
      id: 'student-2',
      role: Role.STUDENT,
      status: UserStatus.ACTIVE,
      nickname: 'KindGirl',
      username: 'student2',
      avatar_url: 'https://cdn.example.com/a2.png',
      real_name: 'Jane Smith',
      selected_hero_id: 'hero-2',
      school_id: 'school-1',
      deleted_at: null,
    };

    const student3 = {
      id: 'student-3',
      role: Role.STUDENT,
      status: UserStatus.ACTIVE,
      nickname: null,
      username: 'student3',
      avatar_url: null,
      real_name: 'Bob Brown',
      selected_hero_id: 'hero-3',
      school_id: 'school-1',
      deleted_at: null,
    };

    const student4 = {
      id: 'student-4',
      role: Role.STUDENT,
      status: UserStatus.ACTIVE,
      nickname: 'CoolCat',
      username: 'student4',
      avatar_url: 'https://cdn.example.com/a4.png',
      real_name: 'Charlie White',
      selected_hero_id: 'hero-4',
      school_id: 'school-1',
      deleted_at: null,
    };

    it('invalid scope → 400', async () => {
      await expect(
        service.getLeaderboard('student-1', { scope: 'district' as any }),
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('forbidden if caller is inactive or not student', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...student1,
        status: UserStatus.INACTIVE,
      });
      await expect(
        service.getLeaderboard('student-1', { scope: LeaderboardScope.CLASS }),
      ).rejects.toMatchObject({
        status: 403,
      });

      prisma.user.findFirst.mockResolvedValue({
        ...student1,
        role: Role.TEACHER,
      });
      await expect(
        service.getLeaderboard('student-1', { scope: LeaderboardScope.CLASS }),
      ).rejects.toMatchObject({
        status: 403,
      });
    });

    it('if student has no approved class, scope=class returns a one-row board of themselves without 404', async () => {
      prisma.user.findFirst.mockResolvedValue(student1);
      prisma.classMembership.findFirst.mockResolvedValue(null);
      prisma.pointsLedger.groupBy.mockResolvedValue([]);

      const result = await service.getLeaderboard('student-1', {
        scope: LeaderboardScope.CLASS,
      });

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0]).toEqual({
        userId: 'student-1',
        nickname: 'HeroKid',
        avatarUrl: 'https://cdn.example.com/a1.png',
        kindnessPoints: 0,
        rank: 1,
      });
      expect(result.data.total).toBe(1);
    });

    it('scope=class excludes a student in another class', async () => {
      prisma.user.findFirst.mockResolvedValue(student1);
      prisma.classMembership.findFirst.mockResolvedValue({
        id: 'mem-1',
        user_id: 'student-1',
        class_id: 'class-1',
        status: JoinRequestStatus.APPROVED,
        class: { id: 'class-1', deleted_at: null },
      });

      prisma.classMembership.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          class_id: 'class-1',
          user_id: 'student-1',
          user: student1,
        },
        {
          id: 'mem-2',
          class_id: 'class-1',
          user_id: 'student-2',
          user: student2,
        },
      ]);

      prisma.pointsLedger.groupBy.mockResolvedValue([
        { user_id: 'student-1', _sum: { kindness_amount: 50 } },
        { user_id: 'student-2', _sum: { kindness_amount: 100 } },
      ]);

      const result = await service.getLeaderboard('student-1', {
        scope: LeaderboardScope.CLASS,
      });

      expect(prisma.classMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            class_id: 'class-1',
          }),
        }),
      );
      expect(result.data.items.map((i: any) => i.userId)).toEqual([
        'student-2',
        'student-1',
      ]);
      expect(result.data.items.some((i: any) => i.userId === 'student-3')).toBe(
        false,
      );
    });

    it('a TEACHER_AWARD row with kindness_amount 0 does not change rank, a GAME_KINDNESS row does', async () => {
      prisma.user.findFirst.mockResolvedValue(student1);
      prisma.classMembership.findFirst.mockResolvedValue({
        id: 'mem-1',
        user_id: 'student-1',
        class_id: 'class-1',
        status: JoinRequestStatus.APPROVED,
        class: { id: 'class-1', deleted_at: null },
      });

      prisma.classMembership.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          class_id: 'class-1',
          user_id: 'student-1',
          user: student1,
        },
        {
          id: 'mem-2',
          class_id: 'class-1',
          user_id: 'student-2',
          user: student2,
        },
      ]);

      prisma.pointsLedger.groupBy.mockResolvedValue([
        { user_id: 'student-1', _sum: { kindness_amount: 50 } },
        { user_id: 'student-2', _sum: { kindness_amount: 0 } },
      ]);

      const res1 = await service.getLeaderboard('student-1', {
        scope: LeaderboardScope.CLASS,
      });

      expect(res1.data.items[0].userId).toBe('student-1');
      expect(res1.data.items[0].rank).toBe(1);
      expect(res1.data.items[1].userId).toBe('student-2');
      expect(res1.data.items[1].rank).toBe(2);

      prisma.pointsLedger.groupBy.mockResolvedValue([
        { user_id: 'student-1', _sum: { kindness_amount: 50 } },
        { user_id: 'student-2', _sum: { kindness_amount: 0 } },
      ]);

      const res2 = await service.getLeaderboard('student-1', {
        scope: LeaderboardScope.CLASS,
      });

      expect(res2.data.items[0].userId).toBe('student-1');
      expect(res2.data.items[0].rank).toBe(1);
      expect(res2.data.items[1].userId).toBe('student-2');
      expect(res2.data.items[1].rank).toBe(2);

      prisma.pointsLedger.groupBy.mockResolvedValue([
        { user_id: 'student-1', _sum: { kindness_amount: 50 } },
        { user_id: 'student-2', _sum: { kindness_amount: 100 } },
      ]);

      const res3 = await service.getLeaderboard('student-1', {
        scope: LeaderboardScope.CLASS,
      });

      expect(res3.data.items[0].userId).toBe('student-2');
      expect(res3.data.items[0].rank).toBe(1);
      expect(res3.data.items[1].userId).toBe('student-1');
      expect(res3.data.items[1].rank).toBe(2);
    });

    it('payload has no real_name and no hero fields', async () => {
      prisma.user.findFirst.mockResolvedValue(student1);
      prisma.classMembership.findFirst.mockResolvedValue(null);
      prisma.pointsLedger.groupBy.mockResolvedValue([]);

      const result = await service.getLeaderboard('student-1', {
        scope: LeaderboardScope.CLASS,
      });

      const item = result.data.items[0];
      expect(item).not.toHaveProperty('real_name');
      expect(item).not.toHaveProperty('realName');
      expect(item).not.toHaveProperty('hero');
      expect(item).not.toHaveProperty('heroId');
      expect(item).not.toHaveProperty('hero_id');
      expect(item).not.toHaveProperty('heroArt');
      expect(item).not.toHaveProperty('hero_art');
      expect(item).not.toHaveProperty('selected_hero_id');
      expect(item).not.toHaveProperty('selectedHeroId');
      expect(Object.keys(item).sort()).toEqual(
        ['userId', 'nickname', 'avatarUrl', 'kindnessPoints', 'rank'].sort(),
      );
    });

    it('competition ranking for ties (1, 2, 2, 4) and pagination', async () => {
      prisma.user.findFirst.mockResolvedValue(student1);
      prisma.classMembership.findFirst.mockResolvedValue({
        id: 'mem-1',
        user_id: 'student-1',
        class_id: 'class-1',
        status: JoinRequestStatus.APPROVED,
        class: { id: 'class-1', deleted_at: null },
      });

      prisma.classMembership.findMany.mockResolvedValue([
        { id: 'm1', user_id: 'student-1', user: student1 },
        { id: 'm2', user_id: 'student-2', user: student2 },
        { id: 'm3', user_id: 'student-3', user: student3 },
        { id: 'm4', user_id: 'student-4', user: student4 },
      ]);

      prisma.pointsLedger.groupBy.mockResolvedValue([
        { user_id: 'student-2', _sum: { kindness_amount: 100 } },
        { user_id: 'student-1', _sum: { kindness_amount: 50 } },
        { user_id: 'student-4', _sum: { kindness_amount: 50 } },
        { user_id: 'student-3', _sum: { kindness_amount: 10 } },
      ]);

      const page1 = await service.getLeaderboard('student-1', {
        scope: LeaderboardScope.CLASS,
        page: 1,
        perPage: 2,
      });

      expect(page1.data.items).toHaveLength(2);
      expect(page1.data.items[0].rank).toBe(1);
      expect(page1.data.items[0].kindnessPoints).toBe(100);
      expect(page1.data.items[1].rank).toBe(2);
      expect(page1.data.items[1].kindnessPoints).toBe(50);

      const page2 = await service.getLeaderboard('student-1', {
        scope: LeaderboardScope.CLASS,
        page: 2,
        perPage: 2,
      });

      expect(page2.data.items).toHaveLength(2);
      expect(page2.data.items[0].rank).toBe(2);
      expect(page2.data.items[0].kindnessPoints).toBe(50);
      expect(page2.data.items[1].rank).toBe(4);
      expect(page2.data.items[1].kindnessPoints).toBe(10);
    });

    it('caller is included even at 0 kindness points', async () => {
      prisma.user.findFirst.mockResolvedValue(student1);
      prisma.classMembership.findFirst.mockResolvedValue({
        id: 'mem-1',
        user_id: 'student-1',
        class_id: 'class-1',
        status: JoinRequestStatus.APPROVED,
        class: { id: 'class-1', deleted_at: null },
      });

      prisma.classMembership.findMany.mockResolvedValue([
        { id: 'm1', user_id: 'student-1', user: student1 },
        { id: 'm2', user_id: 'student-2', user: student2 },
      ]);

      prisma.pointsLedger.groupBy.mockResolvedValue([
        { user_id: 'student-2', _sum: { kindness_amount: 100 } },
      ]);

      const result = await service.getLeaderboard('student-1', {
        scope: LeaderboardScope.CLASS,
      });

      const callerItem = result.data.items.find(
        (i: any) => i.userId === 'student-1',
      );
      expect(callerItem).toBeDefined();
      expect(callerItem.kindnessPoints).toBe(0);
      expect(callerItem.rank).toBe(2);
    });

    it('hides INACTIVE and soft-deleted students', async () => {
      prisma.user.findFirst.mockResolvedValue(student1);
      prisma.classMembership.findFirst.mockResolvedValue({
        id: 'mem-1',
        user_id: 'student-1',
        class_id: 'class-1',
        status: JoinRequestStatus.APPROVED,
        class: { id: 'class-1', deleted_at: null },
      });

      prisma.classMembership.findMany.mockResolvedValue([
        { id: 'm1', user_id: 'student-1', user: student1 },
        {
          id: 'm-inactive',
          user_id: 'student-inactive',
          user: {
            ...student2,
            id: 'student-inactive',
            status: UserStatus.INACTIVE,
          },
        },
        {
          id: 'm-deleted',
          user_id: 'student-deleted',
          user: {
            ...student3,
            id: 'student-deleted',
            deleted_at: new Date(),
          },
        },
      ]);

      prisma.pointsLedger.groupBy.mockResolvedValue([]);

      const result = await service.getLeaderboard('student-1', {
        scope: LeaderboardScope.CLASS,
      });

      const ids = result.data.items.map((i: any) => i.userId);
      expect(ids).toContain('student-1');
      expect(ids).not.toContain('student-inactive');
      expect(ids).not.toContain('student-deleted');
    });

    it('scope=school returns school students ranked', async () => {
      prisma.user.findFirst.mockResolvedValue(student1);
      prisma.user.findMany.mockResolvedValue([student1, student2]);
      prisma.pointsLedger.groupBy.mockResolvedValue([
        { user_id: 'student-1', _sum: { kindness_amount: 30 } },
        { user_id: 'student-2', _sum: { kindness_amount: 80 } },
      ]);

      const result = await service.getLeaderboard('student-1', {
        scope: LeaderboardScope.SCHOOL,
      });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            school_id: 'school-1',
            role: Role.STUDENT,
          }),
        }),
      );

      expect(result.data.items[0].userId).toBe('student-2');
      expect(result.data.items[0].rank).toBe(1);
      expect(result.data.items[1].userId).toBe('student-1');
      expect(result.data.items[1].rank).toBe(2);
    });
  });
});
