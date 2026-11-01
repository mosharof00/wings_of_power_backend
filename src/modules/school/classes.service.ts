import { randomInt } from 'crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  AgeGroup,
  ClassCodeStatus,
  JoinRequestStatus,
  Prisma,
  RenewalRequestStatus,
  Role,
} from 'prisma/generated/client';
import { paginateResponse } from '../../common/pagination/pagination.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassQueryDto } from './dto/class-query.dto';
import {
  ChangeTeacherDto,
  CodeRenewalDto,
  CreateClassDto,
  CreateClassRequestDto,
} from './dto/admin-class.dto';

type MembershipCounts = {
  pending: number;
  approved: number;
  rejected: number;
};

function emptyCounts(): MembershipCounts {
  return { pending: 0, approved: 0, rejected: 0 };
}

@Injectable()
export class ClassesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(teacherId: string, query: ClassQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const where = { teacher_id: teacherId };
    const [total, rows] = await Promise.all([
      this.prisma.class.count({ where }),
      this.prisma.class.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { name: 'asc' },
      }),
    ]);
    const ids = rows.map((row) => row.id);
    const [counts, codes] = await Promise.all([
      this.membershipCounts(ids),
      this.activeCodes(ids),
    ]);

    return {
      success: true,
      data: paginateResponse(
        rows.map((row) =>
          this.toClass(row, counts.get(row.id), codes.get(row.id) ?? null),
        ),
        total,
        page,
        perPage,
      ),
    };
  }

  async detail(teacherId: string, classId: string) {
    const row = await this.ownedClass(classId, teacherId);
    const [counts, codes] = await Promise.all([
      this.membershipCounts([row.id]),
      this.activeCodes([row.id]),
    ]);
    return {
      success: true,
      data: this.toClass(row, counts.get(row.id), codes.get(row.id) ?? null),
    };
  }

  async joinRequests(teacherId: string, classId: string, query: ClassQueryDto) {
    await this.ownedClass(classId, teacherId);
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const where = {
      class_id: classId,
      status: JoinRequestStatus.PENDING,
    };
    const [total, rows] = await Promise.all([
      this.prisma.classMembership.count({ where }),
      this.prisma.classMembership.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { created_at: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              nickname: true,
              real_name: true,
              status: true,
            },
          },
        },
      }),
    ]);

    return {
      success: true,
      data: paginateResponse(
        rows.map((row) => ({
          id: row.id,
          status: row.status,
          createdAt: row.created_at,
          student: {
            id: row.user.id,
            username: row.user.username,
            nickname: row.user.nickname,
            realName: row.user.real_name,
            status: row.user.status,
          },
        })),
        total,
        page,
        perPage,
      ),
    };
  }

  approve(teacherId: string, membershipId: string) {
    return this.decide(teacherId, membershipId, JoinRequestStatus.APPROVED);
  }

  reject(teacherId: string, membershipId: string) {
    return this.decide(teacherId, membershipId, JoinRequestStatus.REJECTED);
  }

  async adminList(adminId: string, query: ClassQueryDto) {
    const schoolId = await this.adminSchool(adminId);
    return this.listWhere({ school_id: schoolId }, query);
  }

  async adminDetail(adminId: string, classId: string) {
    const schoolId = await this.adminSchool(adminId);
    const row = await this.classInSchool(classId, schoolId);
    const [counts, codes] = await Promise.all([
      this.membershipCounts([row.id]),
      this.activeCodes([row.id]),
    ]);
    return {
      success: true,
      data: this.toClass(row, counts.get(row.id), codes.get(row.id) ?? null),
    };
  }

  async createClass(adminId: string, dto: CreateClassDto) {
    const schoolId = await this.adminSchool(adminId);
    await this.teacherInSchool(dto.teacherId, schoolId);
    const created = await this.prisma.class.create({
      data: {
        school_id: schoolId,
        name: dto.name.trim(),
        grade_label: dto.grade.trim(),
        age_group: dto.ageGroup,
        teacher_id: dto.teacherId,
      },
    });
    const code = await this.createActiveCode(created.id, adminId);
    return {
      success: true,
      message: 'Class created',
      data: {
        ...this.toClass(created, emptyCounts(), {
          id: code.id,
          code: code.code,
          expiresAt: code.expires_at,
        }),
        code: code.code,
      },
    };
  }

  async changeTeacher(adminId: string, classId: string, dto: ChangeTeacherDto) {
    const schoolId = await this.adminSchool(adminId);
    await this.classInSchool(classId, schoolId);
    await this.teacherInSchool(dto.teacherId, schoolId);
    const updated = await this.prisma.class.update({
      where: { id: classId },
      data: { teacher_id: dto.teacherId },
    });
    return {
      success: true,
      message: 'Teacher updated',
      data: { id: updated.id, teacherId: updated.teacher_id },
    };
  }

  async regenerateCode(adminId: string, classId: string) {
    const schoolId = await this.adminSchool(adminId);
    await this.classInSchool(classId, schoolId);
    await this.revokeActiveCodes(classId);
    const code = await this.createActiveCode(classId, adminId);
    return {
      success: true,
      message: 'Code regenerated',
      data: { classId, code: code.code, codeId: code.id },
    };
  }

  async classRequests(adminId: string, query: ClassQueryDto) {
    const schoolId = await this.adminSchool(adminId);
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const [creations, renewals] = await Promise.all([
      this.prisma.classCreationRequest.findMany({
        where: { school_id: schoolId },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.classCodeRenewalRequest.findMany({
        where: { class: { school_id: schoolId } },
        include: { class: true },
        orderBy: { created_at: 'desc' },
      }),
    ]);
    const merged = [
      ...creations.map((row) => ({
        type: 'CREATION' as const,
        id: row.id,
        status: row.status,
        createdAt: row.created_at,
        payload: row.payload_json,
        classId: row.resulting_class_id,
      })),
      ...renewals.map((row) => ({
        type: 'RENEWAL' as const,
        id: row.id,
        status: row.status,
        createdAt: row.created_at,
        classId: row.class_id,
        className: row.class.name,
        reason: row.reason,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (page - 1) * perPage;
    return {
      success: true,
      data: paginateResponse(
        merged.slice(start, start + perPage),
        merged.length,
        page,
        perPage,
      ),
    };
  }

  async approveCreation(adminId: string, requestId: string) {
    const schoolId = await this.adminSchool(adminId);
    const request = await this.prisma.classCreationRequest.findFirst({
      where: { id: requestId },
    });
    if (!request) {
      throw new HttpException('Class request not found', HttpStatus.NOT_FOUND);
    }
    if (request.school_id !== schoolId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (request.status !== RenewalRequestStatus.PENDING) {
      throw new HttpException('Request is not pending', HttpStatus.CONFLICT);
    }
    const payload = request.payload_json as {
      name?: string;
      grade?: string;
      age_group?: AgeGroup;
    };
    if (!payload?.name || !payload.age_group) {
      throw new HttpException(
        'Request payload is invalid',
        HttpStatus.BAD_REQUEST,
      );
    }
    const created = await this.prisma.class.create({
      data: {
        school_id: schoolId,
        name: payload.name,
        grade_label: payload.grade ?? null,
        age_group: payload.age_group,
      },
    });
    await this.createActiveCode(created.id, adminId);
    await this.prisma.classCreationRequest.update({
      where: { id: request.id },
      data: {
        status: RenewalRequestStatus.APPROVED,
        resulting_class_id: created.id,
      },
    });
    return {
      success: true,
      message: 'Class request approved',
      data: { id: request.id, resultingClassId: created.id },
    };
  }

  async rejectCreation(adminId: string, requestId: string) {
    const schoolId = await this.adminSchool(adminId);
    const request = await this.prisma.classCreationRequest.findFirst({
      where: { id: requestId },
    });
    if (!request) {
      throw new HttpException('Class request not found', HttpStatus.NOT_FOUND);
    }
    if (request.school_id !== schoolId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (request.status !== RenewalRequestStatus.PENDING) {
      throw new HttpException('Request is not pending', HttpStatus.CONFLICT);
    }
    await this.prisma.classCreationRequest.update({
      where: { id: request.id },
      data: { status: RenewalRequestStatus.REJECTED },
    });
    return { success: true, message: 'Class request rejected' };
  }

  async approveRenewal(adminId: string, requestId: string) {
    const schoolId = await this.adminSchool(adminId);
    const request = await this.prisma.classCodeRenewalRequest.findFirst({
      where: { id: requestId },
      include: { class: true },
    });
    if (!request) {
      throw new HttpException(
        'Renewal request not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (request.class.school_id !== schoolId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (request.status !== RenewalRequestStatus.PENDING) {
      throw new HttpException('Request is not pending', HttpStatus.CONFLICT);
    }
    await this.revokeActiveCodes(request.class_id);
    const code = await this.createActiveCode(request.class_id, adminId);
    await this.prisma.classCodeRenewalRequest.update({
      where: { id: request.id },
      data: {
        status: RenewalRequestStatus.APPROVED,
        resolved_by_id: adminId,
        new_code_id: code.id,
      },
    });
    return {
      success: true,
      message: 'Code renewed',
      data: { id: request.id, code: code.code, newCodeId: code.id },
    };
  }

  async requestClass(teacherId: string, dto: CreateClassRequestDto) {
    const teacher = await this.staffInSchool(teacherId, Role.TEACHER);
    const created = await this.prisma.classCreationRequest.create({
      data: {
        school_id: teacher.school_id as string,
        requested_by_id: teacher.id,
        status: RenewalRequestStatus.PENDING,
        payload_json: {
          name: dto.name.trim(),
          grade: dto.grade.trim(),
          age_group: dto.ageGroup,
        },
      },
    });
    return {
      success: true,
      message: 'Class request sent',
      data: { id: created.id, status: created.status },
    };
  }

  async requestRenewal(
    teacherId: string,
    classId: string,
    dto: CodeRenewalDto,
  ) {
    const row = await this.ownedClass(classId, teacherId);
    const created = await this.prisma.classCodeRenewalRequest.create({
      data: {
        class_id: row.id,
        requested_by_id: teacherId,
        reason: dto?.reason?.trim() || null,
        status: RenewalRequestStatus.PENDING,
      },
    });
    return {
      success: true,
      message: 'Renewal requested',
      data: { id: created.id, status: created.status },
    };
  }

  private async decide(
    teacherId: string,
    membershipId: string,
    status:
      | typeof JoinRequestStatus.APPROVED
      | typeof JoinRequestStatus.REJECTED,
  ) {
    const membership = await this.prisma.classMembership.findFirst({
      where: { id: membershipId },
      include: { class: true },
    });
    if (!membership) {
      throw new HttpException('Join request not found', HttpStatus.NOT_FOUND);
    }
    if (membership.class.teacher_id !== teacherId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (membership.status !== JoinRequestStatus.PENDING) {
      throw new HttpException(
        'Join request is not pending',
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.classMembership.update({
      where: { id: membership.id },
      data:
        status === JoinRequestStatus.APPROVED
          ? {
              status,
              approved_by_id: teacherId,
              approved_at: new Date(),
            }
          : { status },
    });

    return {
      success: true,
      message:
        status === JoinRequestStatus.APPROVED
          ? 'Join request approved'
          : 'Join request rejected',
      data: { id: updated.id, status: updated.status },
    };
  }

  private async listWhere(
    where: { teacher_id: string } | { school_id: string },
    query: ClassQueryDto,
  ) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const [total, rows] = await Promise.all([
      this.prisma.class.count({ where }),
      this.prisma.class.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { name: 'asc' },
      }),
    ]);
    const ids = rows.map((row) => row.id);
    const [counts, codes] = await Promise.all([
      this.membershipCounts(ids),
      this.activeCodes(ids),
    ]);
    return {
      success: true,
      data: paginateResponse(
        rows.map((row) =>
          this.toClass(row, counts.get(row.id), codes.get(row.id) ?? null),
        ),
        total,
        page,
        perPage,
      ),
    };
  }

  private async adminSchool(userId: string) {
    const user = await this.staffInSchool(userId, Role.ADMIN);
    return user.school_id as string;
  }

  private async staffInSchool(userId: string, role: Role) {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user || user.role !== role) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (!user.school_id) {
      throw new HttpException(
        'School is not set up',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return user;
  }

  private async teacherInSchool(teacherId: string, schoolId: string) {
    const teacher = await this.prisma.user.findFirst({
      where: { id: teacherId },
    });
    if (
      !teacher ||
      teacher.role !== Role.TEACHER ||
      teacher.school_id !== schoolId
    ) {
      throw new HttpException(
        'Teacher is not in this school',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return teacher;
  }

  private async classInSchool(classId: string, schoolId: string) {
    const row = await this.prisma.class.findFirst({ where: { id: classId } });
    if (!row) {
      throw new HttpException('Class not found', HttpStatus.NOT_FOUND);
    }
    if (row.school_id !== schoolId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    return row;
  }

  private async revokeActiveCodes(classId: string) {
    await this.prisma.classCode.updateMany({
      where: { class_id: classId, status: ClassCodeStatus.ACTIVE },
      data: { status: ClassCodeStatus.REVOKED },
    });
  }

  private async createActiveCode(classId: string, createdById: string) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = `WING-${randomInt(0, 10000).toString().padStart(4, '0')}`;
      try {
        return await this.prisma.classCode.create({
          data: {
            class_id: classId,
            code,
            status: ClassCodeStatus.ACTIVE,
            created_by_id: createdById,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new HttpException(
      'Could not allocate a class code',
      HttpStatus.CONFLICT,
    );
  }

  private async ownedClass(classId: string, teacherId: string) {
    const row = await this.prisma.class.findFirst({ where: { id: classId } });
    if (!row) {
      throw new HttpException('Class not found', HttpStatus.NOT_FOUND);
    }
    if (row.teacher_id !== teacherId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    return row;
  }

  private async membershipCounts(classIds: string[]) {
    const map = new Map<string, MembershipCounts>();
    for (const id of classIds) {
      map.set(id, { pending: 0, approved: 0, rejected: 0 });
    }
    if (!classIds.length) {
      return map;
    }

    const grouped = await this.prisma.classMembership.groupBy({
      by: ['class_id', 'status'],
      where: { class_id: { in: classIds } },
      _count: { _all: true },
    });
    for (const row of grouped) {
      const bucket = map.get(row.class_id);
      if (!bucket) {
        continue;
      }
      if (row.status === JoinRequestStatus.PENDING) {
        bucket.pending = row._count._all;
      } else if (row.status === JoinRequestStatus.APPROVED) {
        bucket.approved = row._count._all;
      } else if (row.status === JoinRequestStatus.REJECTED) {
        bucket.rejected = row._count._all;
      }
    }
    return map;
  }

  private async activeCodes(classIds: string[]) {
    const map = new Map<
      string,
      { id: string; code: string; expiresAt: Date | null }
    >();
    if (!classIds.length) {
      return map;
    }
    const codes = await this.prisma.classCode.findMany({
      where: {
        class_id: { in: classIds },
        status: ClassCodeStatus.ACTIVE,
        OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
      },
      orderBy: { created_at: 'desc' },
    });
    for (const code of codes) {
      if (!map.has(code.class_id)) {
        map.set(code.class_id, {
          id: code.id,
          code: code.code,
          expiresAt: code.expires_at,
        });
      }
    }
    return map;
  }

  private toClass(
    row: {
      id: string;
      name: string;
      grade_label: string | null;
      age_group: string;
    },
    counts: MembershipCounts | undefined,
    activeCode: { id: string; code: string; expiresAt: Date | null } | null,
  ) {
    return {
      id: row.id,
      name: row.name,
      gradeLabel: row.grade_label,
      ageGroup: row.age_group,
      activeCode,
      membershipCounts: counts ?? { pending: 0, approved: 0, rejected: 0 },
    };
  }
}
