import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { JoinRequestStatus, PointsSource, Role } from 'prisma/generated/client';
import { paginateResponse } from '../../common/pagination/pagination.service';
import { PrismaService } from '../../prisma/prisma.service';
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
