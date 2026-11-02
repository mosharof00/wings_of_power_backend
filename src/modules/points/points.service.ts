import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  JoinRequestStatus,
  PointsSource,
  Role,
  UserStatus,
} from 'prisma/generated/client';
import { paginateResponse } from '../../common/pagination/pagination.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LeaderboardQueryDto, LeaderboardScope } from './dto/leaderboard.dto';
import {
  AwardPointsDto,
  PatchPointRulesDto,
  PointsQueryDto,
} from './dto/points.dto';

const ALLOWED_RULE_KEYS: Record<string, string> = {
  STORY_QUESTION: 'STORY_QUESTION',
  storyPoints: 'STORY_QUESTION',
  KINDNESS_ROUND: 'KINDNESS_ROUND',
  kindnessPoints: 'KINDNESS_ROUND',
  TEACHER_AWARD_MAX: 'TEACHER_AWARD_MAX',
  teacherAward: 'TEACHER_AWARD_MAX',
};

@Injectable()
export class PointsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStudentPoints(studentId: string, query: PointsQueryDto) {
    const page = query?.page ?? 1;
    const perPage = query?.perPage ?? 10;
    const skip = (page - 1) * perPage;

    const [items, total] = await Promise.all([
      this.prisma.pointsLedger.findMany({
        where: {
          user_id: studentId,
        },
        orderBy: {
          created_at: 'desc',
        },
        skip,
        take: perPage,
      }),
      this.prisma.pointsLedger.count({
        where: {
          user_id: studentId,
        },
      }),
    ]);

    const now = new Date();
    const todayStart = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );

    const todayAggregate = await this.prisma.pointsLedger.aggregate({
      where: {
        user_id: studentId,
        created_at: {
          gte: todayStart,
        },
      },
      _sum: {
        amount: true,
      },
    });

    const today = todayAggregate._sum?.amount ?? 0;

    return {
      success: true,
      data: {
        ...paginateResponse(items, total, page, perPage),
        today,
      },
    };
  }

  async awardPoints(teacherId: string, dto: AwardPointsDto) {
    if (
      !dto ||
      typeof dto.amount !== 'number' ||
      !Number.isInteger(dto.amount) ||
      dto.amount <= 0
    ) {
      throw new HttpException(
        'Amount must be a positive integer',
        HttpStatus.BAD_REQUEST,
      );
    }

    const schoolId = await this.teacherSchool(teacherId);

    const membership = await this.prisma.classMembership.findFirst({
      where: {
        user_id: dto.studentId,
        status: JoinRequestStatus.APPROVED,
        class: {
          teacher_id: teacherId,
          deleted_at: null,
        },
      },
    });

    if (!membership) {
      throw new HttpException(
        'Student is not in your classes',
        HttpStatus.FORBIDDEN,
      );
    }

    let maxAward = 5;
    const rule = await this.prisma.pointRule.findFirst({
      where: {
        school_id: schoolId,
        key: 'TEACHER_AWARD_MAX',
      },
    });
    if (rule) {
      maxAward = rule.value_int;
    }

    if (dto.amount > maxAward) {
      throw new HttpException(
        `Amount exceeds maximum allowed (${maxAward})`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const ledger = await this.prisma.pointsLedger.create({
      data: {
        user_id: dto.studentId,
        source: PointsSource.TEACHER_AWARD,
        amount: dto.amount,
        kindness_amount: 0,
        label: dto.category,
        ref_type: 'TeacherAward',
        ref_id: dto.reason ?? null,
        awarded_by_id: teacherId,
      },
    });

    return {
      success: true,
      message: 'Points awarded',
      data: ledger,
    };
  }

  async getTeacherHistory(teacherId: string, query: PointsQueryDto) {
    const page = query?.page ?? 1;
    const perPage = query?.perPage ?? 10;
    const skip = (page - 1) * perPage;

    const [rows, total] = await Promise.all([
      this.prisma.pointsLedger.findMany({
        where: {
          awarded_by_id: teacherId,
          source: PointsSource.TEACHER_AWARD,
        },
        include: {
          user: {
            select: {
              id: true,
              real_name: true,
              nickname: true,
              username: true,
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
        skip,
        take: perPage,
      }),
      this.prisma.pointsLedger.count({
        where: {
          awarded_by_id: teacherId,
          source: PointsSource.TEACHER_AWARD,
        },
      }),
    ]);

    const items = rows.map((row) => ({
      id: row.id,
      studentId: row.user_id,
      studentName:
        row.user?.real_name ??
        row.user?.nickname ??
        row.user?.username ??
        'Student',
      amount: row.amount,
      points: row.amount,
      category: row.label,
      label: row.label,
      reason: row.ref_id,
      awardedById: row.awarded_by_id,
      createdAt: row.created_at,
    }));

    return {
      success: true,
      data: paginateResponse(items, total, page, perPage),
    };
  }

  async getPointRules(adminId: string) {
    const schoolId = await this.adminSchool(adminId);

    const [rulesList, pointsSum, badgeCount] = await Promise.all([
      this.prisma.pointRule.findMany({
        where: { school_id: schoolId },
      }),
      this.prisma.pointsLedger.aggregate({
        where: {
          user: { school_id: schoolId },
        },
        _sum: {
          amount: true,
          kindness_amount: true,
        },
      }),
      this.prisma.badge.count({
        where: {
          deleted_at: null,
          OR: [{ school_id: schoolId }, { school_id: null }],
        },
      }),
    ]);

    const ruleMap = new Map<string, number>();
    for (const r of rulesList) {
      ruleMap.set(r.key, r.value_int);
    }

    const storyPoints = ruleMap.get('STORY_QUESTION') ?? 1;
    const kindnessPoints = ruleMap.get('KINDNESS_ROUND') ?? 50;
    const teacherAward = ruleMap.get('TEACHER_AWARD_MAX') ?? 5;

    return {
      success: true,
      data: {
        summary: {
          totalPositivePoints: pointsSum._sum?.amount ?? 0,
          totalKindnessPoints: pointsSum._sum?.kindness_amount ?? 0,
          totalBadges: badgeCount || 6,
        },
        rules: {
          storyPoints,
          kindnessPoints,
          teacherAward,
          STORY_QUESTION: storyPoints,
          KINDNESS_ROUND: kindnessPoints,
          TEACHER_AWARD_MAX: teacherAward,
        },
      },
    };
  }

  async patchPointRules(
    adminId: string,
    body: PatchPointRulesDto | Record<string, any>,
  ) {
    const schoolId = await this.adminSchool(adminId);

    const keys = Object.keys(body || {});
    if (keys.length === 0) {
      throw new HttpException(
        'At least one point rule must be provided',
        HttpStatus.BAD_REQUEST,
      );
    }

    const updates = new Map<string, number>();
    for (const key of keys) {
      const dbKey = ALLOWED_RULE_KEYS[key];
      if (!dbKey) {
        throw new HttpException(
          `Unknown point rule key: ${key}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      const val = body[key];
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
        throw new HttpException(
          `Value for ${key} must be a non-negative integer`,
          HttpStatus.BAD_REQUEST,
        );
      }
      updates.set(dbKey, val);
    }

    for (const [dbKey, val] of updates.entries()) {
      const existing = await this.prisma.pointRule.findFirst({
        where: {
          school_id: schoolId,
          key: dbKey,
        },
      });

      if (existing) {
        await this.prisma.pointRule.update({
          where: { id: existing.id },
          data: { value_int: val },
        });
      } else {
        await this.prisma.pointRule.create({
          data: {
            school_id: schoolId,
            key: dbKey,
            value_int: val,
          },
        });
      }
    }

    return this.getPointRules(adminId);
  }

  async getLeaderboard(
    studentId: string,
    query?: Partial<LeaderboardQueryDto>,
  ) {
    const scope = query?.scope ?? LeaderboardScope.CLASS;
    if (scope !== LeaderboardScope.CLASS && scope !== LeaderboardScope.SCHOOL) {
      throw new HttpException(
        'Invalid scope: must be class or school',
        HttpStatus.BAD_REQUEST,
      );
    }

    const caller = await this.prisma.user.findFirst({
      where: {
        id: studentId,
        deleted_at: null,
      },
    });

    if (
      !caller ||
      caller.role !== Role.STUDENT ||
      caller.status === UserStatus.INACTIVE
    ) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    let candidateUsers: Array<{
      id: string;
      nickname: string | null;
      username: string | null;
      avatar_url: string | null;
    }> = [];

    if (scope === LeaderboardScope.CLASS) {
      const membership = await this.prisma.classMembership.findFirst({
        where: {
          user_id: caller.id,
          status: JoinRequestStatus.APPROVED,
          class: {
            deleted_at: null,
          },
        },
        include: {
          class: true,
        },
        orderBy: { updated_at: 'desc' },
      });

      if (!membership || !membership.class_id) {
        candidateUsers = [
          {
            id: caller.id,
            nickname: caller.nickname,
            username: caller.username,
            avatar_url: caller.avatar_url,
          },
        ];
      } else {
        const memberships = await this.prisma.classMembership.findMany({
          where: {
            class_id: membership.class_id,
            status: JoinRequestStatus.APPROVED,
            user: {
              role: Role.STUDENT,
              status: { not: UserStatus.INACTIVE },
              deleted_at: null,
            },
          },
          include: {
            user: {
              select: {
                id: true,
                nickname: true,
                username: true,
                avatar_url: true,
                status: true,
                deleted_at: true,
                role: true,
              },
            },
          },
        });

        const candidatesMap = new Map<
          string,
          {
            id: string;
            nickname: string | null;
            username: string | null;
            avatar_url: string | null;
          }
        >();

        for (const m of memberships) {
          if (
            m.user &&
            m.user.status !== UserStatus.INACTIVE &&
            !m.user.deleted_at
          ) {
            candidatesMap.set(m.user.id, {
              id: m.user.id,
              nickname: m.user.nickname,
              username: m.user.username,
              avatar_url: m.user.avatar_url,
            });
          }
        }

        if (!candidatesMap.has(caller.id)) {
          candidatesMap.set(caller.id, {
            id: caller.id,
            nickname: caller.nickname,
            username: caller.username,
            avatar_url: caller.avatar_url,
          });
        }

        candidateUsers = Array.from(candidatesMap.values());
      }
    } else {
      const schoolId = caller.school_id;
      if (!schoolId) {
        candidateUsers = [
          {
            id: caller.id,
            nickname: caller.nickname,
            username: caller.username,
            avatar_url: caller.avatar_url,
          },
        ];
      } else {
        const schoolStudents = await this.prisma.user.findMany({
          where: {
            school_id: schoolId,
            role: Role.STUDENT,
            status: { not: UserStatus.INACTIVE },
            deleted_at: null,
          },
          select: {
            id: true,
            nickname: true,
            username: true,
            avatar_url: true,
            status: true,
            deleted_at: true,
            role: true,
          },
        });

        const candidatesMap = new Map<
          string,
          {
            id: string;
            nickname: string | null;
            username: string | null;
            avatar_url: string | null;
          }
        >();

        for (const s of schoolStudents) {
          if (s.status !== UserStatus.INACTIVE && !s.deleted_at) {
            candidatesMap.set(s.id, {
              id: s.id,
              nickname: s.nickname,
              username: s.username,
              avatar_url: s.avatar_url,
            });
          }
        }

        if (!candidatesMap.has(caller.id)) {
          candidatesMap.set(caller.id, {
            id: caller.id,
            nickname: caller.nickname,
            username: caller.username,
            avatar_url: caller.avatar_url,
          });
        }

        candidateUsers = Array.from(candidatesMap.values());
      }
    }

    const userIds = candidateUsers.map((u) => u.id);
    const pointsMap = new Map<string, number>();

    if (userIds.length > 0) {
      const sums = await this.prisma.pointsLedger.groupBy({
        by: ['user_id'],
        where: {
          user_id: { in: userIds },
        },
        _sum: {
          kindness_amount: true,
        },
      });

      for (const s of sums) {
        pointsMap.set(s.user_id, s._sum?.kindness_amount ?? 0);
      }
    }

    const itemsWithScores = candidateUsers.map((u) => ({
      userId: u.id,
      nickname: u.nickname || u.username || '',
      avatarUrl: u.avatar_url ?? null,
      kindnessPoints: pointsMap.get(u.id) ?? 0,
    }));

    itemsWithScores.sort((a, b) => {
      if (b.kindnessPoints !== a.kindnessPoints) {
        return b.kindnessPoints - a.kindnessPoints;
      }
      const nameCompare = a.nickname.localeCompare(b.nickname);
      if (nameCompare !== 0) return nameCompare;
      return a.userId.localeCompare(b.userId);
    });

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

    const page = Math.max(1, query?.page ?? 1);
    const perPage = Math.max(1, query?.perPage ?? 10);
    const skip = (page - 1) * perPage;
    const total = ranked.length;
    const pagedItems = ranked.slice(skip, skip + perPage);

    return {
      success: true,
      data: paginateResponse(pagedItems, total, page, perPage),
    };
  }

  private async adminSchool(adminId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({ where: { id: adminId } });
    if (!user || user.role !== Role.ADMIN) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (!user.school_id) {
      throw new HttpException(
        'School is not set up',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return user.school_id;
  }

  private async teacherSchool(teacherId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({ where: { id: teacherId } });
    if (!user || user.role !== Role.TEACHER) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (!user.school_id) {
      throw new HttpException(
        'School is not set up',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return user.school_id;
  }
}
