import { HttpException } from '@nestjs/common';
import { BadgeCode, PointsSource, Role } from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BadgesService } from './badges.service';

describe('BadgesService', () => {
  let prisma: any;
  let service: BadgesService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      class: {
        findMany: jest.fn(),
      },
      badge: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      studentBadge: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
      },
      readingProgress: {
        count: jest.fn(),
      },
      chapterProgress: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      pointsLedger: {
        aggregate: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
    };

    service = new BadgesService(prisma as unknown as PrismaService);
  });

  describe('evaluate', () => {
    const studentUser = {
      id: 'student-1',
      role: Role.STUDENT,
      school_id: 'school-1',
    };

    it('empty criteria does not earn', async () => {
      prisma.user.findUnique.mockResolvedValue(studentUser);
      prisma.badge.findMany.mockResolvedValue([
        {
          id: 'badge-empty',
          code: BadgeCode.HELPING_HAND,
          title: 'Helping Hand',
          criteria_json: {},
        },
        {
          id: 'badge-null',
          code: BadgeCode.SPEAK_UP,
          title: 'Speak Up',
          criteria_json: null,
        },
      ]);
      prisma.studentBadge.findMany.mockResolvedValue([]);
      prisma.readingProgress.count.mockResolvedValue(10);
      prisma.chapterProgress.count.mockResolvedValue(20);
      prisma.chapterProgress.findMany.mockResolvedValue([
        { quiz_best_percent: 100 },
      ]);
      prisma.pointsLedger.aggregate.mockResolvedValue({
        _sum: { kindness_amount: 500 },
      });
      prisma.pointsLedger.count.mockResolvedValue(5);

      const earned = await service.evaluate('student-1');

      expect(earned).toEqual([]);
      expect(prisma.studentBadge.create).not.toHaveBeenCalled();
      expect(prisma.pointsLedger.create).not.toHaveBeenCalled();
    });

    it('meeting stories_completed inserts one StudentBadge', async () => {
      prisma.user.findUnique.mockResolvedValue(studentUser);
      prisma.badge.findMany.mockResolvedValue([
        {
          id: 'badge-1',
          code: BadgeCode.STORY_EXPLORER,
          title: 'Story Explorer',
          criteria_json: { stories_completed: 2 },
        },
      ]);
      prisma.studentBadge.findMany.mockResolvedValue([]);
      prisma.readingProgress.count.mockResolvedValue(2);
      prisma.chapterProgress.count.mockResolvedValue(0);
      prisma.chapterProgress.findMany.mockResolvedValue([]);
      prisma.pointsLedger.aggregate.mockResolvedValue({
        _sum: { kindness_amount: 0 },
      });
      prisma.pointsLedger.count.mockResolvedValue(0);
      prisma.studentBadge.create.mockResolvedValue({
        user_id: 'student-1',
        badge_id: 'badge-1',
        earned_at: new Date(),
      });

      const earned = await service.evaluate('student-1');

      expect(earned).toHaveLength(1);
      expect(earned[0].id).toBe('badge-1');
      expect(prisma.studentBadge.create).toHaveBeenCalledTimes(1);
      expect(prisma.studentBadge.create).toHaveBeenCalledWith({
        data: {
          user_id: 'student-1',
          badge_id: 'badge-1',
          earned_at: expect.any(Date),
        },
      });
      expect(prisma.pointsLedger.create).not.toHaveBeenCalled();
    });

    it('second evaluate does not duplicate', async () => {
      prisma.user.findUnique.mockResolvedValue(studentUser);
      prisma.badge.findMany.mockResolvedValue([
        {
          id: 'badge-1',
          code: BadgeCode.STORY_EXPLORER,
          title: 'Story Explorer',
          criteria_json: { stories_completed: 2 },
        },
      ]);
      // Already earned badge-1
      prisma.studentBadge.findMany.mockResolvedValue([{ badge_id: 'badge-1' }]);

      const earned = await service.evaluate('student-1');

      expect(earned).toEqual([]);
      expect(prisma.studentBadge.create).not.toHaveBeenCalled();
      expect(prisma.readingProgress.count).not.toHaveBeenCalled();
    });

    it('bonus_points writes one ledger row', async () => {
      prisma.user.findUnique.mockResolvedValue(studentUser);
      prisma.badge.findMany.mockResolvedValue([
        {
          id: 'badge-bonus',
          code: BadgeCode.KINDNESS_CHAMPION,
          title: 'Kindness Champion',
          criteria_json: { kindness_points: 50, bonus_points: 25 },
        },
      ]);
      prisma.studentBadge.findMany.mockResolvedValue([]);
      prisma.readingProgress.count.mockResolvedValue(0);
      prisma.chapterProgress.count.mockResolvedValue(0);
      prisma.chapterProgress.findMany.mockResolvedValue([]);
      prisma.pointsLedger.aggregate.mockResolvedValue({
        _sum: { kindness_amount: 50 },
      });
      prisma.pointsLedger.count.mockResolvedValue(0);
      prisma.studentBadge.create.mockResolvedValue({
        user_id: 'student-1',
        badge_id: 'badge-bonus',
        earned_at: new Date(),
      });
      prisma.pointsLedger.create.mockResolvedValue({});

      const earned = await service.evaluate('student-1');

      expect(earned).toHaveLength(1);
      expect(prisma.studentBadge.create).toHaveBeenCalledTimes(1);
      expect(prisma.pointsLedger.create).toHaveBeenCalledTimes(1);
      expect(prisma.pointsLedger.create).toHaveBeenCalledWith({
        data: {
          user_id: 'student-1',
          source: PointsSource.BADGE_BONUS,
          amount: 25,
          kindness_amount: 0,
          label: 'Kindness Champion',
          ref_type: 'Badge',
          ref_id: 'badge-bonus',
          awarded_by_id: null,
        },
      });
    });

    it('requires all present keys in compound criteria to be met', async () => {
      prisma.user.findUnique.mockResolvedValue(studentUser);
      prisma.badge.findMany.mockResolvedValue([
        {
          id: 'badge-compound',
          code: BadgeCode.GAME_SHOW_READY,
          title: 'Game Show Ready',
          criteria_json: {
            stories_completed: 2,
            chapters_completed: 6,
            quiz_best_mean: 70,
          },
        },
      ]);
      prisma.studentBadge.findMany.mockResolvedValue([]);

      // stories met (2), chapters met (6), quiz mean NOT met (65)
      prisma.readingProgress.count.mockResolvedValue(2);
      prisma.chapterProgress.count.mockResolvedValue(6);
      prisma.chapterProgress.findMany.mockResolvedValue([
        { quiz_best_percent: 65 },
      ]);
      prisma.pointsLedger.aggregate.mockResolvedValue({
        _sum: { kindness_amount: 0 },
      });
      prisma.pointsLedger.count.mockResolvedValue(0);

      let earned = await service.evaluate('student-1');
      expect(earned).toEqual([]);
      expect(prisma.studentBadge.create).not.toHaveBeenCalled();

      // Now quiz mean IS met (80)
      prisma.chapterProgress.findMany.mockResolvedValue([
        { quiz_best_percent: 80 },
      ]);
      earned = await service.evaluate('student-1');
      expect(earned).toHaveLength(1);
      expect(prisma.studentBadge.create).toHaveBeenCalledTimes(1);
    });

    it('teacher_awards criteria met triggers badge earn', async () => {
      prisma.user.findUnique.mockResolvedValue(studentUser);
      prisma.badge.findMany.mockResolvedValue([
        {
          id: 'badge-ta',
          code: BadgeCode.POSITIVE_LEADER,
          title: 'Positive Leader',
          criteria_json: { teacher_awards: 3 },
        },
      ]);
      prisma.studentBadge.findMany.mockResolvedValue([]);
      prisma.readingProgress.count.mockResolvedValue(0);
      prisma.chapterProgress.count.mockResolvedValue(0);
      prisma.chapterProgress.findMany.mockResolvedValue([]);
      prisma.pointsLedger.aggregate.mockResolvedValue({
        _sum: { kindness_amount: 0 },
      });
      prisma.pointsLedger.count.mockResolvedValue(3);

      const earned = await service.evaluate('student-1');
      expect(earned).toHaveLength(1);
      expect(prisma.studentBadge.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStudentBadges and getStudentBadgeDetail', () => {
    it('returns student badges with earned status and detail does not include other students earned rows', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'student-2',
        role: Role.STUDENT,
        school_id: 'school-1',
      });
      prisma.badge.findMany.mockResolvedValue([
        {
          id: 'badge-1',
          code: BadgeCode.STORY_EXPLORER,
          title: 'Story Explorer',
          description: 'Read stories',
          how_to_earn: 'Complete 2 stories',
          art_url: 'https://example.com/art.png',
          criteria_json: { stories_completed: 2 },
        },
      ]);
      // student-2 has not earned any badges
      prisma.studentBadge.findMany.mockResolvedValue([]);

      const listResult = await service.getStudentBadges('student-2');
      expect(listResult.success).toBe(true);
      expect(listResult.data[0].earned).toBe(false);
      expect(listResult.data[0].earned_at).toBeNull();

      // student detail does not include other students' earned rows
      prisma.badge.findFirst.mockResolvedValue({
        id: 'badge-1',
        code: BadgeCode.STORY_EXPLORER,
        title: 'Story Explorer',
        description: 'Read stories',
        how_to_earn: 'Complete 2 stories',
        art_url: 'https://example.com/art.png',
        criteria_json: { stories_completed: 2 },
        school_id: 'school-1',
      });
      // Even if student-1 earned it, student-2 query returns null
      prisma.studentBadge.findUnique.mockResolvedValue(null);

      const detailResult = await service.getStudentBadgeDetail(
        'student-2',
        'badge-1',
      );
      expect(detailResult.success).toBe(true);
      expect(detailResult.data.earned).toBe(false);
      expect(detailResult.data.earned_at).toBeNull();
      expect(detailResult.data.how_to_earn).toBe('Complete 2 stories');
      expect(detailResult.data.criteria_json).toEqual({ stories_completed: 2 });
    });

    it('throws 404 for unknown badge in student detail', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'student-1',
        school_id: 'school-1',
      });
      prisma.badge.findFirst.mockResolvedValue(null);

      await expect(
        service.getStudentBadgeDetail('student-1', 'nonexistent'),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('getTeacherBadgeMonitor', () => {
    const teacherUser = {
      id: 'teacher-1',
      role: Role.TEACHER,
      school_id: 'school-1',
    };

    it('student in another class is absent from the teacher matrix', async () => {
      prisma.user.findUnique.mockResolvedValue(teacherUser);
      // Teacher owns class-1 only
      prisma.class.findMany.mockResolvedValue([
        { id: 'class-1', name: 'Amber' },
      ]);
      prisma.badge.findMany.mockResolvedValue([
        {
          id: 'badge-1',
          code: BadgeCode.STORY_EXPLORER,
          title: 'Story Explorer',
          art_url: null,
        },
      ]);

      // Only student-in-class-1 is returned
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'student-1',
          real_name: 'Alice Wonder',
          username: 'alice',
          nickname: 'Alice',
          memberships: [{ class: { id: 'class-1', name: 'Amber' } }],
          student_badges: [{ badge_id: 'badge-1', earned_at: new Date() }],
        },
      ]);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.getTeacherBadgeMonitor('teacher-1', {
        page: 1,
        perPage: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].id).toBe('student-1');
      expect(result.data.items[0].className).toBe('Amber');
      expect(result.data.items[0].badges[0].earned).toBe(true);

      // Verify the query to prisma.user.findMany filtered by owned classes
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            memberships: {
              some: {
                class_id: { in: ['class-1'] },
              },
            },
          }),
        }),
      );
    });

    it('throws 403 when teacher tries to filter by class they do not own', async () => {
      prisma.user.findUnique.mockResolvedValue(teacherUser);
      prisma.class.findMany.mockResolvedValue([
        { id: 'class-1', name: 'Amber' },
      ]);

      await expect(
        service.getTeacherBadgeMonitor('teacher-1', {
          page: 1,
          perPage: 10,
          classId: 'class-other',
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('admin badges', () => {
    const adminUser = {
      id: 'admin-1',
      role: Role.ADMIN,
      school_id: 'school-1',
    };

    it('getAdminBadges returns badges and counts', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUser);
      prisma.badge.findMany.mockResolvedValue([
        {
          id: 'badge-1',
          code: BadgeCode.KINDNESS_CHAMPION,
          title: 'Kindness Champion',
          description: 'Award for kindness',
          how_to_earn: '500 kindness points',
          criteria_json: { kindness_points: 500 },
        },
      ]);
      prisma.user.count.mockResolvedValue(25);
      prisma.studentBadge.count.mockResolvedValue(10);

      const result = await service.getAdminBadges('admin-1');

      expect(result.success).toBe(true);
      expect(result.data[0].earnedCount).toBe(10);
      expect(result.data[0].totalStudents).toBe(25);
      expect(result.data[0].threshold).toBe(500);
      expect(result.data[0].thresholdUnit).toBe('kindness point');
      expect(result.data[0].awardType).toBe('AUTOMATIC');
    });

    it('patchAdminBadges updates badge criteria', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUser);
      prisma.badge.findFirst.mockResolvedValue({
        id: 'badge-1',
        code: BadgeCode.STORY_EXPLORER,
        school_id: 'school-1',
      });
      prisma.badge.update.mockResolvedValue({});
      prisma.badge.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.patchAdminBadges('admin-1', {
        badges: [
          {
            id: 'badge-1',
            title: 'Updated Explorer',
            criteria_json: { stories_completed: 5 },
          },
        ],
      });

      expect(prisma.badge.update).toHaveBeenCalledWith({
        where: { id: 'badge-1' },
        data: expect.objectContaining({
          title: 'Updated Explorer',
          criteria_json: { stories_completed: 5 },
        }),
      });
    });

    it('patchAdminBadges rejects invalid badge code', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUser);

      await expect(
        service.patchAdminBadges('admin-1', {
          badges: [
            {
              code: 'INVALID_CODE' as any,
              title: 'Invalid',
            },
          ],
        }),
      ).rejects.toThrow(HttpException);
    });

    it('patchAdminBadges does not allow creating a 7th badge code', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUser);
      prisma.badge.findFirst.mockResolvedValue(null);
      // Already 6 badges exist
      prisma.badge.count.mockResolvedValue(6);

      await expect(
        service.patchAdminBadges('admin-1', {
          badges: [
            {
              code: BadgeCode.HELPING_HAND,
              title: 'Helping Hand',
            },
          ],
        }),
      ).rejects.toThrow(HttpException);
    });
  });
});
