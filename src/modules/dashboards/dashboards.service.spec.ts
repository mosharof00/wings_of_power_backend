import { HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JoinRequestStatus, Role, UserStatus } from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY } from '../../common/guard/role/roles.decorator';
import { AdminDashboardController } from './admin-dashboard.controller';
import { DashboardsService, getMonFriWeek } from './dashboards.service';
import { TeacherDashboardController } from './teacher-dashboard.controller';
import * as progressModule from '../progress/progress.service';

jest.mock('../progress/progress.service', () => ({
  eligibilityFor: jest.fn(),
}));

describe('DashboardsService', () => {
  let service: DashboardsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      class: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      classMembership: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      safeSpaceReport: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      pointsLedger: {
        groupBy: jest.fn(),
        aggregate: jest.fn(),
      },
      story: {
        count: jest.fn(),
      },
    };

    service = new DashboardsService(prisma as unknown as PrismaService);
    jest.clearAllMocks();
  });

  describe('getMonFriWeek (ISO week calculation)', () => {
    it('week buckets are Monday through Friday of the ISO week containing a Wednesday', () => {
      // 2026-11-04 is a Wednesday
      const wednesday = new Date('2026-11-04T12:00:00.000Z');
      const buckets = getMonFriWeek(wednesday);

      expect(buckets).toHaveLength(5);
      expect(buckets.map((b) => b.day)).toEqual([
        'Mon',
        'Tue',
        'Wed',
        'Thu',
        'Fri',
      ]);
      expect(buckets[0].dateStr).toBe('2026-11-02'); // Monday
      expect(buckets[4].dateStr).toBe('2026-11-06'); // Friday
    });

    it('week buckets are Monday through Friday of the ISO week containing Sunday (Sunday is day 7; Friday is the last bucket)', () => {
      // 2026-11-08 is a Sunday
      const sunday = new Date('2026-11-08T18:00:00.000Z');
      const buckets = getMonFriWeek(sunday);

      expect(buckets).toHaveLength(5);
      expect(buckets[0].day).toBe('Mon');
      expect(buckets[0].dateStr).toBe('2026-11-02');
      expect(buckets[4].day).toBe('Fri');
      expect(buckets[4].dateStr).toBe('2026-11-06');
    });

    it('week buckets are Monday through Friday of the ISO week containing Monday (Monday is day 1)', () => {
      // 2026-11-02 is a Monday
      const monday = new Date('2026-11-02T08:00:00.000Z');
      const buckets = getMonFriWeek(monday);

      expect(buckets).toHaveLength(5);
      expect(buckets[0].day).toBe('Mon');
      expect(buckets[0].dateStr).toBe('2026-11-02');
      expect(buckets[4].day).toBe('Fri');
      expect(buckets[4].dateStr).toBe('2026-11-06');
    });
  });

  describe('getTeacherDashboard', () => {
    const mockTeacher = {
      id: 'teacher-1',
      role: Role.TEACHER,
      status: UserStatus.ACTIVE,
      school_id: 'school-1',
      deleted_at: null,
    };

    it('student token → 403 Forbidden', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'student-1',
        role: Role.STUDENT,
        status: UserStatus.ACTIVE,
      });

      await expect(service.getTeacherDashboard('student-1')).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.FORBIDDEN,
        }),
      );
    });

    it('returns empty zero counts when teacher has no classes', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher);
      prisma.class.findMany.mockResolvedValue([]);

      const result = await service.getTeacherDashboard(
        'teacher-1',
        new Date('2026-11-04T12:00:00.000Z'),
      );

      expect(result.success).toBe(true);
      expect(result.data.safeSpaceReports.new).toBe(0);
      expect(result.data.safeSpaceReports.reviewing).toBe(0);
      expect(result.data.pendingJoinRequests).toBe(0);
      expect(result.data.eligibleStudentsCount).toBe(0);
      expect(result.data.leaderboard).toEqual([]);
      expect(result.data.week).toHaveLength(5);
      expect(
        result.data.week.every(
          (d: any) => d.reportsCount === 0 && d.pointsAwarded === 0,
        ),
      ).toBe(true);
    });

    it('teacher counts ignore another teacher’s class', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher);
      // Teacher 1 only teaches class-1 (class-2 belongs to teacher-2)
      prisma.class.findMany.mockResolvedValue([
        { id: 'class-1', name: 'Grade 3 Pine' },
      ]);

      // Reports count
      prisma.safeSpaceReport.count
        .mockResolvedValueOnce(3) // NEW for class-1
        .mockResolvedValueOnce(2) // REVIEWING for class-1
        .mockResolvedValue(1); // Mon-Fri day reports

      // Pending join requests count
      prisma.classMembership.count.mockResolvedValue(4);

      // Approved memberships for teacher classes
      prisma.classMembership.findMany.mockResolvedValue([
        { user_id: 'student-1' },
        { user_id: 'student-2' },
      ]);

      // Eligibility mock
      (progressModule.eligibilityFor as jest.Mock)
        .mockResolvedValueOnce({ eligible: true })
        .mockResolvedValueOnce({ eligible: false });

      // Student candidate details
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'student-1',
          nickname: 'Student One',
          username: 's1',
          avatar_url: 'https://cdn.example.com/s1.png',
        },
        {
          id: 'student-2',
          nickname: 'Student Two',
          username: 's2',
          avatar_url: null,
        },
      ]);

      // Points sum for leaderboard
      prisma.pointsLedger.groupBy.mockResolvedValue([
        { user_id: 'student-1', _sum: { kindness_amount: 150 } },
        { user_id: 'student-2', _sum: { kindness_amount: 80 } },
      ]);

      // Points aggregate for week chart
      prisma.pointsLedger.aggregate.mockResolvedValue({
        _sum: { amount: 25 },
      });

      const result = await service.getTeacherDashboard(
        'teacher-1',
        new Date('2026-11-04T12:00:00.000Z'),
      );

      // Verify class scoping: class query strictly filters by teacherId
      expect(prisma.class.findMany).toHaveBeenCalledWith({
        where: {
          teacher_id: 'teacher-1',
          deleted_at: null,
        },
        select: { id: true, name: true },
      });

      // Verify safe-space report query used class-1 only
      expect(prisma.safeSpaceReport.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ class_id: { in: ['class-1'] } }]),
          }),
        }),
      );

      // Verify pending memberships query used class-1 only
      expect(prisma.classMembership.count).toHaveBeenCalledWith({
        where: {
          class_id: { in: ['class-1'] },
          status: JoinRequestStatus.PENDING,
        },
      });

      expect(result.data.safeSpaceReports).toEqual({
        new: 3,
        reviewing: 2,
        total: 5,
      });
      expect(result.data.pendingJoinRequests).toBe(4);
      expect(result.data.eligibleStudentsCount).toBe(1);

      // Leaderboard checks (same shape as T-BE-020)
      expect(result.data.leaderboard).toHaveLength(2);
      expect(result.data.leaderboard[0]).toEqual({
        userId: 'student-1',
        nickname: 'Student One',
        avatarUrl: 'https://cdn.example.com/s1.png',
        kindnessPoints: 150,
        rank: 1,
      });
      expect(result.data.leaderboard[1]).toEqual({
        userId: 'student-2',
        nickname: 'Student Two',
        avatarUrl: null,
        kindnessPoints: 80,
        rank: 2,
      });
      expect(result.data.leaderboard[0]).not.toHaveProperty('real_name');
      expect(result.data.leaderboard[0]).not.toHaveProperty('realName');
      expect(result.data.leaderboard[0]).not.toHaveProperty('hero');

      // Week chart checks: 5 buckets Mon-Fri
      expect(result.data.week).toHaveLength(5);
      expect(result.data.week[0].day).toBe('Mon');
      expect(result.data.week[4].day).toBe('Fri');
    });
  });

  describe('getAdminDashboard', () => {
    const mockAdmin = {
      id: 'admin-1',
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
      school_id: 'school-1',
      real_name: 'Admin Boss',
      deleted_at: null,
    };

    it('student token → 403 Forbidden', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'student-1',
        role: Role.STUDENT,
        status: UserStatus.ACTIVE,
      });

      await expect(service.getAdminDashboard('student-1')).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.FORBIDDEN,
        }),
      );
    });

    it('returns 422 if admin has no school_id', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...mockAdmin,
        school_id: null,
      });

      await expect(service.getAdminDashboard('admin-1')).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
        }),
      );
    });

    it('returns admin counts and recent activity without analytics series', async () => {
      prisma.user.findFirst.mockResolvedValue(mockAdmin);

      // Student counts by status: ACTIVE, PENDING, INACTIVE
      prisma.user.count
        .mockResolvedValueOnce(50) // ACTIVE students
        .mockResolvedValueOnce(5) // PENDING students
        .mockResolvedValueOnce(2) // INACTIVE students
        .mockResolvedValueOnce(12) // Staff count (TEACHER + ADMIN)
        .mockResolvedValueOnce(10); // Total teachers

      // Published story count
      prisma.story.count.mockResolvedValue(8);

      // Open safe space count: NEW + REVIEWING
      prisma.safeSpaceReport.count
        .mockResolvedValueOnce(3) // NEW
        .mockResolvedValueOnce(2); // REVIEWING

      // Classes count
      prisma.class.count.mockResolvedValue(6);

      // Recent reports (last 10)
      const reportDate = new Date('2026-11-02T10:00:00.000Z');
      prisma.safeSpaceReport.findMany.mockResolvedValue([
        {
          id: 'rep-1',
          submitted_at: reportDate,
          student: { nickname: 'Kiddo', username: 'kid' },
          class: { name: 'Grade 4' },
        },
      ]);

      // Recent join approvals (last 10)
      const approvalDate = new Date('2026-11-02T11:00:00.000Z');
      prisma.classMembership.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          approved_at: approvalDate,
          user: { nickname: 'NewStudent', username: 'newbie' },
          approved_by: { real_name: 'Ms. Smith' },
          class: { name: 'Grade 4' },
        },
      ]);

      const result = await service.getAdminDashboard('admin-1');

      expect(result.success).toBe(true);

      // 1. Student counts by status
      expect(result.data.studentCountsByStatus).toEqual(
        expect.objectContaining({
          active: 50,
          pending: 5,
          inactive: 2,
          total: 57,
        }),
      );
      expect(result.data.totalStudents).toBe(57);
      expect(result.data.pendingStudents).toBe(5);

      // 2. Staff count
      expect(result.data.staffCount).toBe(12);

      // 3. Published story count
      expect(result.data.publishedStoryCount).toBe(8);

      // 4. Open safe space count (NEW + REVIEWING)
      expect(result.data.openSafeSpaceCount).toBe(5);

      // 5. Classes count
      expect(result.data.classesCount).toBe(6);

      // 6. Recent activity: reports and join approvals, each { type, id, at, label }
      expect(result.data.activity).toHaveLength(2);
      expect(result.data.activity[0]).toEqual({
        type: 'JOIN_APPROVAL',
        id: 'mem-1',
        at: approvalDate.toISOString(),
        label: 'Join request approved for NewStudent',
        actor: 'Ms. Smith',
        sentence: 'approved join request for NewStudent',
      });
      expect(result.data.activity[1]).toEqual({
        type: 'SAFE_SPACE_REPORT',
        id: 'rep-1',
        at: reportDate.toISOString(),
        label: 'Safe Space report submitted',
        actor: 'Kiddo',
        sentence: 'filed a safe space report',
      });

      // REQUIRED TEST: admin payload has NO analytics series beyond the counts listed
      expect(result.data).not.toHaveProperty('week');
      expect(result.data).not.toHaveProperty('readingHours');
      expect(result.data).not.toHaveProperty('listeningHours');
      expect(result.data).not.toHaveProperty('learningOverview');
      expect(result.data).not.toHaveProperty('analytics');
    });
  });

  describe('Controllers role metadata', () => {
    const reflector = new Reflector();

    it('TeacherDashboardController requires TEACHER role', () => {
      const roles = reflector.get<Role[]>(
        ROLES_KEY,
        TeacherDashboardController,
      );
      expect(roles).toEqual([Role.TEACHER]);
    });

    it('AdminDashboardController requires ADMIN role', () => {
      const roles = reflector.get<Role[]>(ROLES_KEY, AdminDashboardController);
      expect(roles).toEqual([Role.ADMIN]);
    });
  });
});
