import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  JoinRequestStatus,
  ReportCategory,
  ReportStatus,
  SafeSpaceReport,
} from 'prisma/generated/client';
import { paginateResponse } from '../../common/pagination/pagination.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateReportDto,
  CreateVisitDto,
  ReportQueryDto,
} from './dto/report.dto';

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
}

