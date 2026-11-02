import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  JoinRequestStatus,
  PointsSource,
  PublishStatus,
  ReportStatus,
  Role,
  UserStatus,
} from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { eligibilityFor } from '../progress/progress.service';

export interface WeekBucket {
  day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
  start: Date;
  end: Date;
  dateStr: string;
}

export function getMonFriWeek(referenceDate: Date = new Date()): WeekBucket[] {
  const ref = new Date(referenceDate);
  const dayOfWeek = ref.getUTCDay(); // 0: Sun, 1: Mon, ..., 6: Sat
  const isoDay = dayOfWeek === 0 ? 7 : dayOfWeek; // 1 (Mon) to 7 (Sun)

  const monday = new Date(ref);
  monday.setUTCDate(ref.getUTCDate() - (isoDay - 1));
  monday.setUTCHours(0, 0, 0, 0);

  const days: Array<'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri'> = [
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
  ];

  return days.map((day, index) => {
    const start = new Date(monday);
    start.setUTCDate(monday.getUTCDate() + index);
    start.setUTCHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 1);
    end.setUTCHours(0, 0, 0, 0);

    const y = start.getUTCFullYear();
    const m = String(start.getUTCMonth() + 1).padStart(2, '0');
    const d = String(start.getUTCDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    return { day, start, end, dateStr };
  });
}

@Injectable()
export class DashboardsService {
  constructor(private readonly prisma: PrismaService) {}

  async getTeacherDashboard(
    teacherId: string,
    referenceDate: Date = new Date(),
  ) {
    const teacher = await this.prisma.user.findFirst({
      where: { id: teacherId, deleted_at: null },
    });

    if (!teacher || teacher.role !== Role.TEACHER) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    // 1. Classes assigned to teacher
    const teacherClasses = await this.prisma.class.findMany({
      where: {
        teacher_id: teacherId,
        deleted_at: null,
      },
      select: { id: true, name: true },
    });
    const classIds = teacherClasses.map((c) => c.id);

    // If teacher has no classes, return default empty response
    if (classIds.length === 0) {
      const emptyWeek = getMonFriWeek(referenceDate).map((b) => ({
        day: b.day,
        date: b.dateStr,
        reportsCount: 0,
        reports: 0,
        pointsAwarded: 0,
        points: 0,
      }));

      return {
        success: true,
        data: {
          safeSpaceReports: {
            new: 0,
            reviewing: 0,
            total: 0,
          },
          safeSpaceNew: 0,
          safeSpaceReviewing: 0,
          pendingJoinRequests: 0,
          pendingStudents: 0,
          eligibleStudentsCount: 0,
          eligibleStudents: 0,
          gameEligibleStudents: 0,
          leaderboard: [],
          week: emptyWeek,
          charts: {
            week: emptyWeek,
          },
        },
      };
    }

    // 2. Safe-space report counts for their classes (NEW, REVIEWING)
    const reportsWhere = {
      OR: [
        { class_id: { in: classIds } },
        {
          student: {
            memberships: {
              some: {
                class_id: { in: classIds },
                status: JoinRequestStatus.APPROVED,
              },
            },
          },
        },
      ],
    };

    const [newReportsCount, reviewingReportsCount] = await Promise.all([
      this.prisma.safeSpaceReport.count({
        where: {
          ...reportsWhere,
          status: ReportStatus.NEW,
        },
      }),
      this.prisma.safeSpaceReport.count({
        where: {
          ...reportsWhere,
          status: ReportStatus.REVIEWING,
        },
      }),
    ]);

    // 3. Pending join requests for teacher classes
    const pendingJoinRequests = await this.prisma.classMembership.count({
      where: {
        class_id: { in: classIds },
        status: JoinRequestStatus.PENDING,
      },
    });

    // 4. Students eligible for game show (call eligibilityFor from progress.service.ts)
    const approvedMemberships = await this.prisma.classMembership.findMany({
      where: {
        class_id: { in: classIds },
        status: JoinRequestStatus.APPROVED,
        user: {
          role: Role.STUDENT,
          status: { not: UserStatus.INACTIVE },
          deleted_at: null,
        },
      },
      select: {
        user_id: true,
      },
      distinct: ['user_id'],
    });

    const studentUserIds = approvedMemberships.map((m) => m.user_id);

    let eligibleStudentsCount = 0;
    for (const studentId of studentUserIds) {
      const result = await eligibilityFor(this.prisma, studentId);
      if (result.eligible) {
        eligibleStudentsCount++;
      }
    }

    // 5. Small kindness leaderboard (top 5 of their classes, same shape as T-BE-020)
    let leaderboard: Array<{
      userId: string;
      nickname: string;
      avatarUrl: string | null;
      kindnessPoints: number;
      rank: number;
    }> = [];

    if (studentUserIds.length > 0) {
      const candidateUsers = await this.prisma.user.findMany({
        where: {
          id: { in: studentUserIds },
          role: Role.STUDENT,
          status: { not: UserStatus.INACTIVE },
          deleted_at: null,
        },
        select: {
          id: true,
          nickname: true,
          username: true,
          avatar_url: true,
        },
      });

      const pointsSums = await this.prisma.pointsLedger.groupBy({
        by: ['user_id'],
        where: {
          user_id: { in: studentUserIds },
        },
        _sum: {
          kindness_amount: true,
        },
      });

      const pointsMap = new Map<string, number>();
      for (const s of pointsSums) {
        pointsMap.set(s.user_id, s._sum?.kindness_amount ?? 0);
      }

      const itemsWithScores = candidateUsers.map((u) => ({
        userId: u.id,
        nickname: u.nickname || u.username || '',
        avatarUrl: u.avatar_url ?? null,
        kindnessPoints: pointsMap.get(u.id) ?? 0,
      }));

      // Sort by kindnessPoints desc, then nickname asc, then userId asc
      itemsWithScores.sort((a, b) => {
        if (b.kindnessPoints !== a.kindnessPoints) {
          return b.kindnessPoints - a.kindnessPoints;
        }
        const nameCompare = a.nickname.localeCompare(b.nickname);
        if (nameCompare !== 0) return nameCompare;
        return a.userId.localeCompare(b.userId);
      });

      // Rank calculation with ties sharing same rank (T-BE-020 pattern)
      const ranked: Array<{
        userId: string;
        nickname: string;
        avatarUrl: string | null;
        kindnessPoints: number;
        rank: number;
      }> = [];

      for (let i = 0; i < itemsWithScores.length; i++) {
        const current = itemsWithScores[i];
        if (
          i > 0 &&
          current.kindnessPoints === itemsWithScores[i - 1].kindnessPoints
        ) {
          ranked.push({
            ...current,
            rank: ranked[i - 1].rank,
          });
        } else {
          ranked.push({
            ...current,
            rank: i + 1,
          });
        }
      }

      leaderboard = ranked.slice(0, 5);
    }

    // 6. Chart buckets for current Mon-Fri week only
    const weekBuckets = getMonFriWeek(referenceDate);
    const weekChart = await Promise.all(
      weekBuckets.map(async (bucket) => {
        const [dayReportsCount, dayPointsSum] = await Promise.all([
          this.prisma.safeSpaceReport.count({
            where: {
              ...reportsWhere,
              created_at: {
                gte: bucket.start,
                lt: bucket.end,
              },
            },
          }),
          studentUserIds.length > 0
            ? this.prisma.pointsLedger.aggregate({
                where: {
                  user_id: { in: studentUserIds },
                  source: {
                    in: [PointsSource.TEACHER_AWARD, PointsSource.STORY_QUIZ],
                  },
                  created_at: {
                    gte: bucket.start,
                    lt: bucket.end,
                  },
                },
                _sum: {
                  amount: true,
                },
              })
            : { _sum: { amount: 0 } },
        ]);

        const pointsAwarded = dayPointsSum._sum?.amount ?? 0;

        return {
          day: bucket.day,
          date: bucket.dateStr,
          reportsCount: dayReportsCount,
          reports: dayReportsCount,
          pointsAwarded,
          points: pointsAwarded,
        };
      }),
    );

    return {
      success: true,
      data: {
        safeSpaceReports: {
          new: newReportsCount,
          reviewing: reviewingReportsCount,
          total: newReportsCount + reviewingReportsCount,
        },
        safeSpaceNew: newReportsCount,
        safeSpaceReviewing: reviewingReportsCount,
        pendingJoinRequests,
        pendingStudents: pendingJoinRequests,
        eligibleStudentsCount,
        eligibleStudents: eligibleStudentsCount,
        gameEligibleStudents: eligibleStudentsCount,
        leaderboard,
        week: weekChart,
        charts: {
          week: weekChart,
        },
      },
    };
  }

  async getAdminDashboard(adminId: string) {
    const admin = await this.prisma.user.findFirst({
      where: { id: adminId, deleted_at: null },
    });

    if (!admin || admin.role !== Role.ADMIN) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    if (!admin.school_id) {
      throw new HttpException(
        'School is not set up',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const schoolId = admin.school_id;

    // 1. Student counts by status
    const [activeStudents, pendingStudents, inactiveStudents] =
      await Promise.all([
        this.prisma.user.count({
          where: {
            school_id: schoolId,
            role: Role.STUDENT,
            status: UserStatus.ACTIVE,
            deleted_at: null,
          },
        }),
        this.prisma.user.count({
          where: {
            school_id: schoolId,
            role: Role.STUDENT,
            status: UserStatus.PENDING,
            deleted_at: null,
          },
        }),
        this.prisma.user.count({
          where: {
            school_id: schoolId,
            role: Role.STUDENT,
            status: UserStatus.INACTIVE,
            deleted_at: null,
          },
        }),
      ]);

    const totalStudents = activeStudents + pendingStudents + inactiveStudents;

    // 2. Staff count
    const staffCount = await this.prisma.user.count({
      where: {
        school_id: schoolId,
        role: { in: [Role.TEACHER, Role.ADMIN] },
        deleted_at: null,
      },
    });

    const totalTeachers = await this.prisma.user.count({
      where: {
        school_id: schoolId,
        role: Role.TEACHER,
        deleted_at: null,
      },
    });

    // 3. Published story count
    const publishedStoryCount = await this.prisma.story.count({
      where: {
        school_id: schoolId,
        status: PublishStatus.PUBLISHED,
        deleted_at: null,
      },
    });

    // 4. Open Safe Space count (NEW + REVIEWING)
    const [safeSpaceNew, safeSpaceReviewing] = await Promise.all([
      this.prisma.safeSpaceReport.count({
        where: {
          school_id: schoolId,
          status: ReportStatus.NEW,
        },
      }),
      this.prisma.safeSpaceReport.count({
        where: {
          school_id: schoolId,
          status: ReportStatus.REVIEWING,
        },
      }),
    ]);
    const openSafeSpaceCount = safeSpaceNew + safeSpaceReviewing;

    // 5. Classes count
    const classesCount = await this.prisma.class.count({
      where: {
        school_id: schoolId,
        deleted_at: null,
      },
    });

    // 6. Recent activity: last 10 reports and last 10 join approvals (approved_at)
    const [recentReports, recentApprovals] = await Promise.all([
      this.prisma.safeSpaceReport.findMany({
        where: { school_id: schoolId },
        orderBy: { submitted_at: 'desc' },
        take: 10,
        include: {
          student: {
            select: {
              id: true,
              nickname: true,
              username: true,
              real_name: true,
            },
          },
          class: {
            select: { id: true, name: true },
          },
        },
      }),
      this.prisma.classMembership.findMany({
        where: {
          class: { school_id: schoolId, deleted_at: null },
          status: JoinRequestStatus.APPROVED,
          approved_at: { not: null },
        },
        orderBy: { approved_at: 'desc' },
        take: 10,
        include: {
          user: {
            select: {
              id: true,
              nickname: true,
              username: true,
              real_name: true,
            },
          },
          approved_by: {
            select: {
              id: true,
              nickname: true,
              username: true,
              real_name: true,
            },
          },
          class: {
            select: { id: true, name: true },
          },
        },
      }),
    ]);

    const reportActivities = recentReports.map((r) => {
      const studentName =
        r.student?.nickname || r.student?.username || 'Student';
      return {
        type: 'SAFE_SPACE_REPORT',
        id: r.id,
        at: r.submitted_at.toISOString(),
        label: `Safe Space report submitted`,
        actor: studentName,
        sentence: `filed a safe space report`,
      };
    });

    const approvalActivities = recentApprovals.map((a) => {
      const studentName = a.user?.nickname || a.user?.username || 'Student';
      const approverName =
        a.approved_by?.real_name || a.approved_by?.nickname || 'Teacher';
      return {
        type: 'JOIN_APPROVAL',
        id: a.id,
        at: a.approved_at!.toISOString(),
        label: `Join request approved for ${studentName}`,
        actor: approverName,
        sentence: `approved join request for ${studentName}`,
      };
    });

    const allActivity = [...reportActivities, ...approvalActivities].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    );

    const greetingName =
      admin.real_name || admin.nickname || admin.username || 'Admin';
    const attentionCount = openSafeSpaceCount + pendingStudents;

    return {
      success: true,
      data: {
        studentCountsByStatus: {
          active: activeStudents,
          pending: pendingStudents,
          inactive: inactiveStudents,
          total: totalStudents,
          ACTIVE: activeStudents,
          PENDING: pendingStudents,
          INACTIVE: inactiveStudents,
        },
        studentCounts: {
          active: activeStudents,
          pending: pendingStudents,
          inactive: inactiveStudents,
          total: totalStudents,
        },
        totalStudents,
        pendingStudents,
        students: {
          total: totalStudents,
          active: activeStudents,
          pending: pendingStudents,
          inactive: inactiveStudents,
        },
        staffCount,
        totalStaff: staffCount,
        totalTeachers,
        publishedStoryCount,
        openSafeSpaceCount,
        openReportsCount: openSafeSpaceCount,
        safeSpaceReports: {
          new: safeSpaceNew,
          reviewing: safeSpaceReviewing,
          open: openSafeSpaceCount,
        },
        classesCount,
        totalClasses: classesCount,
        activity: allActivity,
        recentActivity: allActivity,
        greetingName,
        attentionCount,
      },
    };
  }
}
