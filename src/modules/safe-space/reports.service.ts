import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  JoinRequestStatus,
  ReportCategory,
  ReportStatus,
  Role,
  SafeSpaceReport,
} from 'prisma/generated/client';
import { paginateResponse } from '../../common/pagination/pagination.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateReportDto,
  CreateVisitDto,
  ReportQueryDto,
} from './dto/report.dto';
import {
  AddReportNoteDto,
  StaffReportQueryDto,
  UpdateReportDto,
} from './dto/staff-report.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async createReport(studentId: string, dto: CreateReportDto) {
    if (!dto) {
      throw new HttpException('Invalid payload', HttpStatus.BAD_REQUEST);
    }

    if (
      !dto.body ||
      typeof dto.body !== 'string' ||
      dto.body.trim().length === 0
    ) {
      throw new HttpException('Body is required', HttpStatus.BAD_REQUEST);
    }

    if (dto.body.length > 200) {
      throw new HttpException(
        'Body cannot exceed 200 characters',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      !dto.category ||
      !Object.values(ReportCategory).includes(dto.category)
    ) {
      throw new HttpException('Invalid category', HttpStatus.BAD_REQUEST);
    }

    const feelSafe =
      typeof dto.feelSafe === 'boolean'
        ? dto.feelSafe
        : typeof dto.feel_safe === 'boolean'
          ? dto.feel_safe
          : undefined;

    if (typeof feelSafe !== 'boolean') {
      throw new HttpException(
        'feelSafe must be a boolean',
        HttpStatus.BAD_REQUEST,
      );
    }

    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      include: {
        memberships: {
          where: { status: JoinRequestStatus.APPROVED },
          include: { class: true },
          orderBy: { created_at: 'desc' },
        },
      },
    });

    if (!student) {
      throw new HttpException('Student not found', HttpStatus.NOT_FOUND);
    }

    const approvedMembership = student.memberships?.[0];
    const classId = approvedMembership?.class_id ?? null;
    const schoolId = approvedMembership?.class?.school_id ?? student.school_id;

    if (!schoolId) {
      throw new HttpException(
        'Student does not belong to a school',
        HttpStatus.BAD_REQUEST,
      );
    }

    const publicRef = await this.generatePublicRef();

    const report = await this.prisma.safeSpaceReport.create({
      data: {
        public_ref: publicRef,
        school_id: schoolId,
        student_id: studentId,
        class_id: classId,
        category: dto.category,
        body: dto.body.trim(),
        feel_safe: feelSafe,
        status: ReportStatus.NEW,
        submitted_at: new Date(),
      },
    });

    const serialized = this.toStudentReport(report);

    return {
      success: true,
      message: 'Safe space report submitted',
      data: {
        ...serialized,
        publicRef: report.public_ref,
        public_ref: report.public_ref,
        report: serialized,
      },
    };
  }

  async listStudentReports(studentId: string, query?: ReportQueryDto) {
    const page = query?.page ? Number(query.page) : 1;
    const perPage = query?.perPage ? Number(query.perPage) : 10;
    const skip = (page - 1) * perPage;

    const where: any = {
      student_id: studentId,
    };

    if (query?.status) {
      where.status = query.status;
    }

    const [items, total] = await Promise.all([
      this.prisma.safeSpaceReport.findMany({
        where,
        orderBy: { submitted_at: 'desc' },
        skip,
        take: perPage,
      }),
      this.prisma.safeSpaceReport.count({ where }),
    ]);

    const serializedItems = items.map((r) => this.toStudentReport(r));

    return {
      success: true,
      data: paginateResponse(serializedItems, total, page, perPage),
    };
  }

  async getStudentReport(studentId: string, id: string) {
    const report = await this.prisma.safeSpaceReport.findUnique({
      where: { id },
    });

    if (!report || report.student_id !== studentId) {
      throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
    }

    return {
      success: true,
      data: this.toStudentReport(report),
    };
  }

  async listTeacherReports(teacherId: string, query?: StaffReportQueryDto) {
    await this.verifyTeacherSafeSpaceAccess(teacherId);

    if (query?.status) {
      if (!Object.values(ReportStatus).includes(query.status)) {
        throw new HttpException('Invalid status', HttpStatus.BAD_REQUEST);
      }
    }

    const page = query?.page ? Number(query.page) : 1;
    const perPage = query?.perPage ? Number(query.perPage) : 10;
    const skip = (page - 1) * perPage;

    const teacherClasses = await this.prisma.class.findMany({
      where: { teacher_id: teacherId },
      select: { id: true },
    });

    const classIds = teacherClasses.map((c) => c.id);
    if (classIds.length === 0) {
      return {
        success: true,
        data: paginateResponse([], 0, page, perPage),
      };
    }

    const where: any = {
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

    if (query?.status) {
      where.status = query.status;
    }

    const [items, total] = await Promise.all([
      this.prisma.safeSpaceReport.findMany({
        where,
        include: {
          student: {
            select: {
              id: true,
              nickname: true,
              real_name: true,
              avatar_url: true,
            },
          },
          class: {
            select: { id: true, name: true, grade_label: true },
          },
          assignee: {
            select: { id: true, nickname: true, real_name: true },
          },
        },
        orderBy: { submitted_at: 'desc' },
        skip,
        take: perPage,
      }),
      this.prisma.safeSpaceReport.count({ where }),
    ]);

    return {
      success: true,
      data: paginateResponse(
        items.map((r) => this.toStaffReport(r, false)),
        total,
        page,
        perPage,
      ),
    };
  }

  async getTeacherReport(teacherId: string, id: string) {
    await this.verifyTeacherSafeSpaceAccess(teacherId);

    const report = await this.prisma.safeSpaceReport.findUnique({
      where: { id },
      include: {
        student: {
          select: {
            id: true,
            nickname: true,
            real_name: true,
            avatar_url: true,
            memberships: {
              where: { status: JoinRequestStatus.APPROVED },
              select: { class_id: true },
            },
          },
        },
        class: {
          select: { id: true, name: true, grade_label: true },
        },
        assignee: {
          select: { id: true, nickname: true, real_name: true },
        },
        notes: {
          include: {
            author: {
              select: { id: true, nickname: true, real_name: true, role: true },
            },
          },
          orderBy: { created_at: 'asc' },
        },
      },
    });

    if (!report) {
      throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
    }

    const teacherClasses = await this.prisma.class.findMany({
      where: { teacher_id: teacherId },
      select: { id: true },
    });
    const classIds = new Set(teacherClasses.map((c) => c.id));

    const isClassMatch = report.class_id
      ? classIds.has(report.class_id)
      : false;
    const isStudentMatch = report.student?.memberships?.some(
      (m) => m.class_id && classIds.has(m.class_id),
    );

    if (!isClassMatch && !isStudentMatch) {
      throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
    }

    return {
      success: true,
      data: this.toStaffReport(report, true),
    };
  }

  async addTeacherReportNote(
    teacherId: string,
    id: string,
    dto: AddReportNoteDto,
  ) {
    await this.verifyTeacherSafeSpaceAccess(teacherId);

    if (
      !dto ||
      !dto.body ||
      typeof dto.body !== 'string' ||
      dto.body.trim().length === 0
    ) {
      throw new HttpException('Body is required', HttpStatus.BAD_REQUEST);
    }

    const report = await this.prisma.safeSpaceReport.findUnique({
      where: { id },
      include: {
        student: {
          select: {
            id: true,
            memberships: {
              where: { status: JoinRequestStatus.APPROVED },
              select: { class_id: true },
            },
          },
        },
      },
    });

    if (!report) {
      throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
    }

    const teacherClasses = await this.prisma.class.findMany({
      where: { teacher_id: teacherId },
      select: { id: true },
    });
    const classIds = new Set(teacherClasses.map((c) => c.id));

    const isClassMatch = report.class_id
      ? classIds.has(report.class_id)
      : false;
    const isStudentMatch = report.student?.memberships?.some(
      (m) => m.class_id && classIds.has(m.class_id),
    );

    if (!isClassMatch && !isStudentMatch) {
      throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
    }

    const note = await this.prisma.safeSpaceNote.create({
      data: {
        report_id: id,
        author_id: teacherId,
        body: dto.body.trim(),
      },
      include: {
        author: {
          select: { id: true, nickname: true, real_name: true, role: true },
        },
      },
    });

    return {
      success: true,
      message: 'Note added',
      data: this.toNoteResponse(note),
    };
  }

  async listAdminReports(adminId: string, query?: StaffReportQueryDto) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new HttpException('Admin not found', HttpStatus.NOT_FOUND);
    }

    if (query?.status) {
      if (!Object.values(ReportStatus).includes(query.status)) {
        throw new HttpException('Invalid status', HttpStatus.BAD_REQUEST);
      }
    }

    const page = query?.page ? Number(query.page) : 1;
    const perPage = query?.perPage ? Number(query.perPage) : 10;
    const skip = (page - 1) * perPage;

    const where: any = {};
    if (admin.school_id) {
      where.school_id = admin.school_id;
    }
    if (query?.status) {
      where.status = query.status;
    }

    const [items, total] = await Promise.all([
      this.prisma.safeSpaceReport.findMany({
        where,
        include: {
          student: {
            select: {
              id: true,
              nickname: true,
              real_name: true,
              avatar_url: true,
            },
          },
          class: {
            select: { id: true, name: true, grade_label: true },
          },
          assignee: {
            select: { id: true, nickname: true, real_name: true },
          },
        },
        orderBy: { submitted_at: 'desc' },
        skip,
        take: perPage,
      }),
      this.prisma.safeSpaceReport.count({ where }),
    ]);

    return {
      success: true,
      data: paginateResponse(
        items.map((r) => this.toStaffReport(r, false)),
        total,
        page,
        perPage,
      ),
    };
  }

  async getAdminReport(adminId: string, id: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new HttpException('Admin not found', HttpStatus.NOT_FOUND);
    }

    const report = await this.prisma.safeSpaceReport.findUnique({
      where: { id },
      include: {
        student: {
          select: {
            id: true,
            nickname: true,
            real_name: true,
            avatar_url: true,
          },
        },
        class: {
          select: { id: true, name: true, grade_label: true },
        },
        assignee: {
          select: { id: true, nickname: true, real_name: true },
        },
        notes: {
          include: {
            author: {
              select: { id: true, nickname: true, real_name: true, role: true },
            },
          },
          orderBy: { created_at: 'asc' },
        },
      },
    });

    if (!report) {
      throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
    }

    if (admin.school_id && report.school_id !== admin.school_id) {
      throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
    }

    return {
      success: true,
      data: this.toStaffReport(report, true),
    };
  }

  async updateAdminReport(adminId: string, id: string, dto: UpdateReportDto) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new HttpException('Admin not found', HttpStatus.NOT_FOUND);
    }

    const report = await this.prisma.safeSpaceReport.findUnique({
      where: { id },
    });

    if (!report) {
      throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
    }

    if (admin.school_id && report.school_id !== admin.school_id) {
      throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
    }

    if (dto.status !== undefined) {
      if (!Object.values(ReportStatus).includes(dto.status)) {
        throw new HttpException('Invalid status', HttpStatus.BAD_REQUEST);
      }
    }

    const assigneeId =
      dto.assigneeId !== undefined ? dto.assigneeId : dto.assignee_id;

    if (assigneeId !== undefined && assigneeId !== null) {
      const assignee = await this.prisma.user.findUnique({
        where: { id: assigneeId },
      });

      if (!assignee || assignee.role !== Role.TEACHER) {
        throw new HttpException(
          'Assignee must be a teacher in the school',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (
        report.school_id &&
        assignee.school_id &&
        assignee.school_id !== report.school_id
      ) {
        throw new HttpException(
          'Assignee must be a teacher in the same school',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const updateData: any = {};
    if (dto.status !== undefined) {
      updateData.status = dto.status;
    }
    if (assigneeId !== undefined) {
      updateData.assignee_id = assigneeId;
    }

    const updated = await this.prisma.safeSpaceReport.update({
      where: { id },
      data: updateData,
      include: {
        student: {
          select: {
            id: true,
            nickname: true,
            real_name: true,
            avatar_url: true,
          },
        },
        class: {
          select: { id: true, name: true, grade_label: true },
        },
        assignee: {
          select: { id: true, nickname: true, real_name: true },
        },
        notes: {
          include: {
            author: {
              select: { id: true, nickname: true, real_name: true, role: true },
            },
          },
          orderBy: { created_at: 'asc' },
        },
      },
    });

    return {
      success: true,
      message: 'Report updated',
      data: this.toStaffReport(updated, true),
    };
  }

  async addAdminReportNote(adminId: string, id: string, dto: AddReportNoteDto) {
    if (
      !dto ||
      !dto.body ||
      typeof dto.body !== 'string' ||
      dto.body.trim().length === 0
    ) {
      throw new HttpException('Body is required', HttpStatus.BAD_REQUEST);
    }

    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new HttpException('Admin not found', HttpStatus.NOT_FOUND);
    }

    const report = await this.prisma.safeSpaceReport.findUnique({
      where: { id },
    });

    if (!report) {
      throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
    }

    if (admin.school_id && report.school_id !== admin.school_id) {
      throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
    }

    const note = await this.prisma.safeSpaceNote.create({
      data: {
        report_id: id,
        author_id: adminId,
        body: dto.body.trim(),
      },
      include: {
        author: {
          select: { id: true, nickname: true, real_name: true, role: true },
        },
      },
    });

    return {
      success: true,
      message: 'Note added',
      data: this.toNoteResponse(note),
    };
  }

  async createVisit(userId: string, dto?: CreateVisitDto) {
    const matchId = dto?.matchId || dto?.match_id || null;

    const visit = await this.prisma.safeSpaceVisit.create({
      data: {
        user_id: userId,
        match_id: matchId,
      },
    });

    return {
      success: true,
      message: 'Safe space visit recorded',
      data: {
        id: visit.id,
        userId: visit.user_id,
        matchId: visit.match_id,
        createdAt: visit.created_at,
      },
    };
  }

  private async verifyTeacherSafeSpaceAccess(teacherId: string) {
    const teacher = await this.prisma.user.findUnique({
      where: { id: teacherId },
    });

    if (!teacher) {
      throw new HttpException('Teacher not found', HttpStatus.NOT_FOUND);
    }

    if (teacher.role !== Role.TEACHER) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const settings = teacher.settings_json as {
      canAccessSafeSpace?: boolean;
    } | null;
    if (settings && settings.canAccessSafeSpace === false) {
      throw new HttpException(
        'Teacher does not have permission to access Safe Space',
        HttpStatus.FORBIDDEN,
      );
    }

    return teacher;
  }

  private async generatePublicRef(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = `WP-${Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0')}`;
      const exists = await this.prisma.safeSpaceReport.findUnique({
        where: { public_ref: candidate },
      });
      if (!exists) {
        return candidate;
      }
    }
    return `WP-${Math.floor(1000 + Math.random() * 9000).toString()}`;
  }

  private toStudentReport(report: SafeSpaceReport) {
    return {
      id: report.id,
      publicRef: report.public_ref,
      public_ref: report.public_ref,
      schoolId: report.school_id,
      studentId: report.student_id,
      classId: report.class_id,
      category: report.category,
      body: report.body,
      feelSafe: report.feel_safe,
      status: report.status,
      submittedAt: report.submitted_at,
      createdAt: report.created_at,
      updatedAt: report.updated_at,
    };
  }

  private toStaffReport(report: any, includeNotes: boolean = false) {
    const result: any = {
      id: report.id,
      publicRef: report.public_ref,
      public_ref: report.public_ref,
      schoolId: report.school_id,
      school_id: report.school_id,
      studentId: report.student_id,
      student_id: report.student_id,
      studentNickname: report.student?.nickname ?? null,
      studentName:
        report.student?.real_name ?? report.student?.nickname ?? null,
      classId: report.class_id,
      class_id: report.class_id,
      className: report.class?.name ?? null,
      category: report.category,
      body: report.body,
      feelSafe: report.feel_safe,
      feel_safe: report.feel_safe,
      status: report.status,
      assigneeId: report.assignee_id,
      assignee_id: report.assignee_id,
      submittedAt: report.submitted_at,
      createdAt: report.created_at,
      updatedAt: report.updated_at,
    };

    if (report.student) {
      result.student = {
        id: report.student.id,
        nickname: report.student.nickname,
        realName: report.student.real_name,
        avatarUrl: report.student.avatar_url,
      };
    }

    if (report.class) {
      result.class = {
        id: report.class.id,
        name: report.class.name,
        grade: report.class.grade_label ?? report.class.grade ?? null,
      };
    }

    if (report.assignee) {
      result.assignee = {
        id: report.assignee.id,
        nickname: report.assignee.nickname,
        realName: report.assignee.real_name,
      };
    }

    if (includeNotes) {
      result.notes = Array.isArray(report.notes)
        ? report.notes.map((n: any) => this.toNoteResponse(n))
        : [];
    }

    return result;
  }

  private toNoteResponse(note: any) {
    return {
      id: note.id,
      reportId: note.report_id,
      report_id: note.report_id,
      authorId: note.author_id,
      author_id: note.author_id,
      body: note.body,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
      author: note.author
        ? {
            id: note.author.id,
            nickname: note.author.nickname,
            realName: note.author.real_name,
            role: note.author.role,
          }
        : null,
    };
  }
}
