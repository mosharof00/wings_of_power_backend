import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { JoinRequestStatus, Role, UserStatus } from 'prisma/generated/client';
import { paginateResponse } from '../../common/pagination/pagination.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MoveClassDto,
  StudentListQueryDto,
  TeacherStudentListQueryDto,
  UpdateStudentStatusDto,
} from './dto/student-admin.dto';

type MembershipRow = {
  id: string;
  class_id: string;
  status: JoinRequestStatus;
  class: { id: string; name: string; teacher_id: string | null } | null;
};

type StudentRow = {
  id: string;
  role: Role;
  status: UserStatus;
  username: string | null;
  nickname: string | null;
  real_name: string | null;
  avatar_url: string | null;
  school_id: string | null;
  memberships: MembershipRow[];
};

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  async adminList(adminId: string, query: StudentListQueryDto) {
    const schoolId = await this.adminSchool(adminId);
    return this.listStudents(
      {
        deleted_at: null,
        role: Role.STUDENT,
        school_id: schoolId,
        ...(query.status ? { status: query.status } : {}),
      },
      query,
    );
  }

  async adminDetail(adminId: string, studentId: string) {
    const schoolId = await this.adminSchool(adminId);
    const student = await this.studentInSchool(studentId, schoolId);
    return { success: true, data: this.studentDetail(student) };
  }

  async updateStatus(
    adminId: string,
    studentId: string,
    dto: UpdateStudentStatusDto,
  ) {
    const schoolId = await this.adminSchool(adminId);
    await this.studentInSchool(studentId, schoolId);
    if (
      dto.status !== UserStatus.ACTIVE &&
      dto.status !== UserStatus.INACTIVE
    ) {
      throw new HttpException(
        'Status must be ACTIVE or INACTIVE',
        HttpStatus.BAD_REQUEST,
      );
    }
    const updated = await this.prisma.user.update({
      where: { id: studentId },
      data: { status: dto.status },
    });
    return {
      success: true,
      message: 'Student updated',
      data: { id: updated.id, status: updated.status },
    };
  }

  async approve(adminId: string, studentId: string) {
    const schoolId = await this.adminSchool(adminId);
    await this.studentInSchool(studentId, schoolId);
    const updated = await this.prisma.user.update({
      where: { id: studentId },
      data: { status: UserStatus.ACTIVE },
    });
    return {
      success: true,
      message: 'Student approved',
      data: { id: updated.id, status: updated.status },
    };
  }

  async moveClass(adminId: string, studentId: string, dto: MoveClassDto) {
    const schoolId = await this.adminSchool(adminId);
    await this.studentInSchool(studentId, schoolId);
    const destination = await this.prisma.class.findFirst({
      where: { id: dto.classId },
    });
    if (!destination) {
      throw new HttpException('Class not found', HttpStatus.NOT_FOUND);
    }
    if (destination.school_id !== schoolId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const existing = await this.prisma.classMembership.findFirst({
      where: { class_id: destination.id, user_id: studentId },
    });
    if (!existing) {
      await this.prisma.classMembership.create({
        data: {
          class_id: destination.id,
          user_id: studentId,
          status: JoinRequestStatus.APPROVED,
          approved_by_id: adminId,
          approved_at: new Date(),
        },
      });
    } else if (existing.status !== JoinRequestStatus.APPROVED) {
      await this.prisma.classMembership.update({
        where: { id: existing.id },
        data: {
          status: JoinRequestStatus.APPROVED,
          approved_by_id: adminId,
          approved_at: new Date(),
        },
      });
    }

    return {
      success: true,
      message: 'Student moved',
      data: { classId: destination.id, status: JoinRequestStatus.APPROVED },
    };
  }

  async teacherList(teacherId: string, query: TeacherStudentListQueryDto) {
    const schoolId = await this.teacherSchool(teacherId);
    const classes = await this.prisma.class.findMany({
      where: { teacher_id: teacherId, school_id: schoolId },
      select: { id: true },
    });
    const ownedIds = classes.map((row) => row.id);
    if (query.classId && !ownedIds.includes(query.classId)) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    const classIds = query.classId ? [query.classId] : ownedIds;
    return this.listStudents(
      {
        deleted_at: null,
        role: Role.STUDENT,
        school_id: schoolId,
        memberships: { some: { class_id: { in: classIds } } },
        ...(query.status ? { status: query.status } : {}),
      },
      query,
    );
  }

  async teacherDetail(teacherId: string, studentId: string) {
    const schoolId = await this.teacherSchool(teacherId);
    const student = await this.studentInSchool(studentId, schoolId);
    const visible = student.memberships.some(
      (membership) => membership.class?.teacher_id === teacherId,
    );
    if (!visible) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    return {
      success: true,
      data: this.studentDetail(student, teacherId),
    };
  }

  private studentDetail(student: StudentRow, teacherId?: string) {
    const memberships = teacherId
      ? student.memberships.filter(
          (membership) => membership.class?.teacher_id === teacherId,
        )
      : student.memberships;
    const membership = this.displayMembership(memberships);
    return {
      user: {
        id: student.id,
        username: student.username,
        nickname: student.nickname,
        realName: student.real_name,
        status: student.status,
        avatarUrl: student.avatar_url,
        role: student.role,
      },
      membership: membership
        ? {
            id: membership.id,
            classId: membership.class_id,
            className: membership.class?.name ?? null,
            status: membership.status,
          }
        : null,
      points: [],
      badges: [],
      progress: [],
      reports: [],
    };
  }

  private async listStudents(where: object, query: StudentListQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: [{ real_name: 'asc' }, { username: 'asc' }],
        include: {
          memberships: {
            include: { class: true },
            orderBy: { updated_at: 'desc' },
          },
        },
      }),
    ]);
    return {
      success: true,
      data: paginateResponse(
        rows.map((row) => this.toListItem(row as StudentRow)),
        total,
        page,
        perPage,
      ),
    };
  }

  private toListItem(student: StudentRow) {
    const membership = this.displayMembership(student.memberships);
    return {
      id: student.id,
      username: student.username,
      nickname: student.nickname,
      realName: student.real_name,
      status: student.status,
      avatarUrl: student.avatar_url,
      class: membership?.class
        ? { id: membership.class.id, name: membership.class.name }
        : null,
    };
  }

  private displayMembership(memberships: MembershipRow[]) {
    const approved = memberships.filter(
      (membership) => membership.status === JoinRequestStatus.APPROVED,
    );
    return (approved.length ? approved : memberships)[0] ?? null;
  }

  private async adminSchool(userId: string) {
    return this.staffSchool(userId, Role.ADMIN);
  }

  private async teacherSchool(userId: string) {
    return this.staffSchool(userId, Role.TEACHER);
  }

  private async staffSchool(userId: string, role: Role) {
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
    return user.school_id;
  }

  private async studentInSchool(studentId: string, schoolId: string) {
    const student = await this.prisma.user.findFirst({
      where: {
        id: studentId,
        role: Role.STUDENT,
        school_id: schoolId,
        deleted_at: null,
      },
      include: {
        memberships: {
          include: { class: true },
          orderBy: { updated_at: 'desc' },
        },
      },
    });
    if (!student) {
      throw new HttpException('Student not found', HttpStatus.NOT_FOUND);
    }
    return student as StudentRow;
  }
}
