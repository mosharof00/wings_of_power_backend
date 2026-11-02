import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { BadgeCode, PointsSource, Role } from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PatchBadgesDto,
  TeacherBadgeMonitorQueryDto,
  UpdateBadgeItemDto,
} from './dto/badge.dto';

export const SUPPORTED_CRITERIA_KEYS = [
  'stories_completed',
  'chapters_completed',
  'quiz_best_mean',
  'kindness_points',
  'teacher_awards',
] as const;

export interface CriteriaMetrics {
  storiesCompleted: number;
  chaptersCompleted: number;
  quizBestMean: number;
  hasScoredChapters: boolean;
  kindnessPoints: number;
  teacherAwards: number;
}

@Injectable()
export class BadgesService {
  constructor(private readonly prisma: PrismaService) {}

  checkCriteriaMet(criteria: any, metrics: CriteriaMetrics): boolean {
    if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) {
      return false;
    }

    let presentKeysCount = 0;

    for (const key of SUPPORTED_CRITERIA_KEYS) {
      if (criteria[key] !== undefined && criteria[key] !== null) {
        presentKeysCount++;
        const target = Number(criteria[key]);
        if (isNaN(target)) {
          return false;
        }

        switch (key) {
          case 'stories_completed':
            if (metrics.storiesCompleted < target) return false;
            break;
          case 'chapters_completed':
            if (metrics.chaptersCompleted < target) return false;
            break;
          case 'quiz_best_mean':
            if (!metrics.hasScoredChapters || metrics.quizBestMean < target)
              return false;
            break;
          case 'kindness_points':
            if (metrics.kindnessPoints < target) return false;
            break;
          case 'teacher_awards':
            if (metrics.teacherAwards < target) return false;
            break;
        }
      }
    }

    // Empty criteria_json never auto-earns
    if (presentKeysCount === 0) {
      return false;
    }

    return true;
  }

  async evaluate(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      return [];
    }

    const badges = await this.prisma.badge.findMany({
      where: {
        deleted_at: null,
        ...(user.school_id
          ? { OR: [{ school_id: user.school_id }, { school_id: null }] }
          : {}),
      },
    });

    const existingStudentBadges = await this.prisma.studentBadge.findMany({
      where: { user_id: userId },
      select: { badge_id: true },
    });
    const earnedBadgeIds = new Set(
      existingStudentBadges.map((sb) => sb.badge_id),
    );

    const unearned = badges.filter((b) => !earnedBadgeIds.has(b.id));
    if (unearned.length === 0) {
      return [];
    }

    const [
      storiesCompleted,
      chaptersCompleted,
      scoredChapters,
      pointsSum,
      teacherAwards,
    ] = await Promise.all([
      this.prisma.readingProgress.count({
        where: {
          user_id: userId,
          completed_at: { not: null },
          story: { deleted_at: null },
        },
      }),
      this.prisma.chapterProgress.count({
        where: {
          user_id: userId,
          completed_at: { not: null },
          chapter: { deleted_at: null },
        },
      }),
      this.prisma.chapterProgress.findMany({
        where: {
          user_id: userId,
          quiz_best_percent: { not: null },
          chapter: { deleted_at: null },
        },
        select: { quiz_best_percent: true },
      }),
      this.prisma.pointsLedger.aggregate({
        where: { user_id: userId },
        _sum: { kindness_amount: true },
      }),
      this.prisma.pointsLedger.count({
        where: {
          user_id: userId,
          source: PointsSource.TEACHER_AWARD,
        },
      }),
    ]);

    const hasScoredChapters = scoredChapters.length > 0;
    const quizBestMean = hasScoredChapters
      ? scoredChapters.reduce(
          (acc, row) => acc + (row.quiz_best_percent ?? 0),
          0,
        ) / scoredChapters.length
      : 0;
    const kindnessPoints = pointsSum._sum?.kindness_amount ?? 0;

    const metrics: CriteriaMetrics = {
      storiesCompleted,
      chaptersCompleted,
      quizBestMean,
      hasScoredChapters,
      kindnessPoints,
      teacherAwards,
    };

    const newlyEarnedBadges: any[] = [];

    for (const badge of unearned) {
      let criteria = badge.criteria_json as any;
      if (typeof criteria === 'string') {
        try {
          criteria = JSON.parse(criteria);
        } catch {
          criteria = null;
        }
      }

      if (this.checkCriteriaMet(criteria, metrics)) {
        try {
          await this.prisma.studentBadge.create({
            data: {
              user_id: userId,
              badge_id: badge.id,
              earned_at: new Date(),
            },
          });
          earnedBadgeIds.add(badge.id);
          newlyEarnedBadges.push(badge);

          if (
            criteria &&
            criteria.bonus_points !== undefined &&
            criteria.bonus_points !== null
          ) {
            const bonus = Number(criteria.bonus_points);
            if (!isNaN(bonus)) {
              await this.prisma.pointsLedger.create({
                data: {
                  user_id: userId,
                  source: PointsSource.BADGE_BONUS,
                  amount: bonus,
                  kindness_amount: 0,
                  label: badge.title ?? 'Badge Bonus',
                  ref_type: 'Badge',
                  ref_id: badge.id,
                  awarded_by_id: null,
                },
              });
            }
          }
        } catch {
          // Ignore duplicate insert if race condition occurs
        }
      }
    }

    return newlyEarnedBadges;
  }

  async getStudentBadges(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { school_id: true },
    });

    const badges = await this.prisma.badge.findMany({
      where: {
        deleted_at: null,
        ...(user?.school_id
          ? { OR: [{ school_id: user.school_id }, { school_id: null }] }
          : {}),
      },
      orderBy: { code: 'asc' },
    });

    const earnedRows = await this.prisma.studentBadge.findMany({
      where: { user_id: userId },
    });
    const earnedMap = new Map(earnedRows.map((row) => [row.badge_id, row]));

    const data = badges.map((badge) => {
      const earnedRecord = earnedMap.get(badge.id);
      return {
        id: badge.id,
        code: badge.code,
        title: badge.title,
        name: badge.title,
        description: badge.description,
        how_to_earn: badge.how_to_earn,
        howToEarn: badge.how_to_earn,
        art_url: badge.art_url,
        artUrl: badge.art_url,
        criteria_json: badge.criteria_json,
        criteriaJson: badge.criteria_json,
        earned: !!earnedRecord,
        earned_at: earnedRecord?.earned_at ?? null,
        earnedAt: earnedRecord?.earned_at ?? null,
      };
    });

    return {
      success: true,
      data,
    };
  }

  async getStudentBadgeDetail(userId: string, badgeId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { school_id: true },
    });

    const badge = await this.prisma.badge.findFirst({
      where: {
        id: badgeId,
        deleted_at: null,
      },
    });

    if (!badge) {
      throw new HttpException('Badge not found', HttpStatus.NOT_FOUND);
    }

    if (
      badge.school_id &&
      user?.school_id &&
      badge.school_id !== user.school_id
    ) {
      throw new HttpException('Badge not found', HttpStatus.NOT_FOUND);
    }

    const studentBadge = await this.prisma.studentBadge.findUnique({
      where: {
        user_id_badge_id: {
          user_id: userId,
          badge_id: badgeId,
        },
      },
    });

    return {
      success: true,
      data: {
        id: badge.id,
        code: badge.code,
        title: badge.title,
        name: badge.title,
        description: badge.description,
        how_to_earn: badge.how_to_earn,
        howToEarn: badge.how_to_earn,
        art_url: badge.art_url,
        artUrl: badge.art_url,
        criteria_json: badge.criteria_json,
        criteriaJson: badge.criteria_json,
        earned: !!studentBadge,
        earned_at: studentBadge?.earned_at ?? null,
        earnedAt: studentBadge?.earned_at ?? null,
      },
    };
  }

  async getAdminBadges(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { school_id: true },
    });

    const badges = await this.prisma.badge.findMany({
      where: {
        deleted_at: null,
        ...(admin?.school_id
          ? { OR: [{ school_id: admin.school_id }, { school_id: null }] }
          : {}),
      },
      orderBy: { code: 'asc' },
    });

    const totalStudents = await this.prisma.user.count({
      where: {
        role: Role.STUDENT,
        deleted_at: null,
        ...(admin?.school_id ? { school_id: admin.school_id } : {}),
      },
    });

    const data = await Promise.all(
      badges.map(async (badge) => {
        const earnedCount = await this.prisma.studentBadge.count({
          where: {
            badge_id: badge.id,
            user: {
              role: Role.STUDENT,
              deleted_at: null,
              ...(admin?.school_id ? { school_id: admin.school_id } : {}),
            },
          },
        });

        let criteria = badge.criteria_json as any;
        if (typeof criteria === 'string') {
          try {
            criteria = JSON.parse(criteria);
          } catch {
            criteria = {};
          }
        }

        let threshold: number | null = null;
        let thresholdUnit: string | null = null;
        let awardType = 'AUTOMATIC';

        if (criteria) {
          if (criteria.kindness_points !== undefined) {
            threshold = Number(criteria.kindness_points);
            thresholdUnit = 'kindness point';
          } else if (criteria.stories_completed !== undefined) {
            threshold = Number(criteria.stories_completed);
            thresholdUnit = 'Stories';
          } else if (criteria.chapters_completed !== undefined) {
            threshold = Number(criteria.chapters_completed);
            thresholdUnit = 'Chapters';
          } else if (criteria.quiz_best_mean !== undefined) {
            threshold = Number(criteria.quiz_best_mean);
            thresholdUnit = '%';
          } else if (criteria.teacher_awards !== undefined) {
            threshold = Number(criteria.teacher_awards);
            thresholdUnit = 'Awards';
            awardType = 'TEACHER';
          }
        }

        return {
          id: badge.id,
          code: badge.code,
          title: badge.title,
          name: badge.title,
          description: badge.description,
          criteriaDescription: badge.description,
          how_to_earn: badge.how_to_earn,
          howToEarn: badge.how_to_earn,
          art_url: badge.art_url,
          artUrl: badge.art_url,
          criteria_json: badge.criteria_json,
          criteriaJson: badge.criteria_json,
          threshold,
          thresholdUnit,
          awardType,
          earnedCount,
          totalStudents,
        };
      }),
    );

    return {
      success: true,
      data,
    };
  }

  async patchAdminBadges(adminId: string, dto: PatchBadgesDto) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { school_id: true },
    });

    const items: UpdateBadgeItemDto[] = [];
    if (dto.badges && Array.isArray(dto.badges) && dto.badges.length > 0) {
      items.push(...dto.badges);
    } else if (dto.id || dto.code) {
      items.push(dto);
    } else {
      throw new HttpException(
        'No badge updates provided',
        HttpStatus.BAD_REQUEST,
      );
    }

    const validCodes = Object.values(BadgeCode);

    for (const item of items) {
      if (item.code && !validCodes.includes(item.code)) {
        throw new HttpException('Invalid badge code', HttpStatus.BAD_REQUEST);
      }

      let existingBadge = null;
      if (item.id) {
        existingBadge = await this.prisma.badge.findFirst({
          where: { id: item.id, deleted_at: null },
        });
        if (!existingBadge) {
          throw new HttpException('Badge not found', HttpStatus.NOT_FOUND);
        }
        if (
          existingBadge.school_id &&
          admin?.school_id &&
          existingBadge.school_id !== admin.school_id
        ) {
          throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
        }
      } else if (item.code) {
        existingBadge = await this.prisma.badge.findFirst({
          where: { code: item.code, deleted_at: null },
        });
        if (!existingBadge) {
          const currentBadgeCount = await this.prisma.badge.count({
            where: { deleted_at: null },
          });
          if (currentBadgeCount >= 6) {
            throw new HttpException(
              'Cannot create additional badge codes',
              HttpStatus.BAD_REQUEST,
            );
          }
        }
      }

      if (!existingBadge && !item.code) {
        throw new HttpException(
          'Badge ID or Code is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      let criteria = item.criteria_json ?? item.criteriaJson;
      if (
        !criteria &&
        item.threshold !== undefined &&
        item.threshold !== null
      ) {
        const code = item.code ?? existingBadge?.code;
        if (code === BadgeCode.KINDNESS_CHAMPION) {
          criteria = { kindness_points: item.threshold };
        } else if (code === BadgeCode.STORY_EXPLORER) {
          criteria = { stories_completed: item.threshold };
        } else if (code === BadgeCode.GAME_SHOW_READY) {
          criteria = { quiz_best_mean: item.threshold };
        } else {
          criteria = { teacher_awards: item.threshold };
        }
      }

      const updateData: any = {};
      if (item.title !== undefined) updateData.title = item.title;
      if (item.description !== undefined)
        updateData.description = item.description;
      const howToEarn = item.how_to_earn ?? item.howToEarn;
      if (howToEarn !== undefined) updateData.how_to_earn = howToEarn;
      const artUrl = item.art_url ?? item.artUrl;
      if (artUrl !== undefined) updateData.art_url = artUrl;
      if (criteria !== undefined) updateData.criteria_json = criteria;

      if (existingBadge) {
        await this.prisma.badge.update({
          where: { id: existingBadge.id },
          data: updateData,
        });
      }
    }

    return this.getAdminBadges(adminId);
  }

  async getTeacherBadgeMonitor(
    teacherId: string,
    query: TeacherBadgeMonitorQueryDto,
  ) {
    const teacher = await this.prisma.user.findUnique({
      where: { id: teacherId },
      select: { school_id: true },
    });

    const classes = await this.prisma.class.findMany({
      where: {
        teacher_id: teacherId,
        deleted_at: null,
        ...(teacher?.school_id ? { school_id: teacher.school_id } : {}),
      },
      select: { id: true, name: true },
    });

    const ownedClassIds = classes.map((c) => c.id);

    if (query.classId) {
      if (!ownedClassIds.includes(query.classId)) {
        throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      }
    }

    const targetClassIds = query.classId ? [query.classId] : ownedClassIds;

    const badges = await this.prisma.badge.findMany({
      where: {
        deleted_at: null,
        ...(teacher?.school_id
          ? { OR: [{ school_id: teacher.school_id }, { school_id: null }] }
          : {}),
      },
      orderBy: { code: 'asc' },
    });

    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const skip = (page - 1) * perPage;

    if (targetClassIds.length === 0) {
      return {
        success: true,
        data: {
          items: [],
          total: 0,
          page,
          perPage,
          lastPage: 0,
          badges: badges.map((b) => ({
            id: b.id,
            code: b.code,
            title: b.title,
            artUrl: b.art_url,
            art_url: b.art_url,
          })),
        },
      };
    }

    const whereStudent = {
      role: Role.STUDENT,
      deleted_at: null,
      memberships: {
        some: {
          class_id: { in: targetClassIds },
        },
      },
    };

    const [students, total] = await Promise.all([
      this.prisma.user.findMany({
        where: whereStudent,
        include: {
          memberships: {
            where: { class_id: { in: targetClassIds } },
            include: { class: true },
          },
          student_badges: {
            where: { badge_id: { in: badges.map((b) => b.id) } },
          },
        },
        orderBy: { real_name: 'asc' },
        skip,
        take: perPage,
      }),
      this.prisma.user.count({ where: whereStudent }),
    ]);

    const items = students.map((student) => {
      const earnedMap = new Map(
        student.student_badges.map((sb) => [sb.badge_id, sb]),
      );

      const studentBadges = badges.map((badge) => {
        const sb = earnedMap.get(badge.id);
        return {
          badgeId: badge.id,
          badge_id: badge.id,
          code: badge.code,
          title: badge.title,
          artUrl: badge.art_url,
          art_url: badge.art_url,
          earned: !!sb,
          earnedAt: sb?.earned_at ?? null,
          earned_at: sb?.earned_at ?? null,
        };
      });

      return {
        id: student.id,
        studentId: student.id,
        student_id: student.id,
        name:
          student.real_name ||
          student.nickname ||
          student.username ||
          'Student',
        realName: student.real_name,
        real_name: student.real_name,
        nickname: student.nickname,
        username: student.username,
        className: student.memberships[0]?.class?.name ?? null,
        classId: student.memberships[0]?.class?.id ?? null,
        badges: studentBadges,
      };
    });

    return {
      success: true,
      data: {
        items,
        total,
        page,
        perPage,
        lastPage: Math.ceil(total / perPage),
        badges: badges.map((b) => ({
          id: b.id,
          code: b.code,
          title: b.title,
          artUrl: b.art_url,
          art_url: b.art_url,
        })),
      },
    };
  }
}
