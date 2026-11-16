import { createHash, randomBytes } from 'crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  ClassCodeStatus,
  Prisma,
  Role,
  UserStatus,
} from 'prisma/generated/client';
import { paginateResponse } from '../../common/pagination/pagination.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import appConfig from '../../config/app.config';
import {
  InviteStaffDto,
  StaffListQueryDto,
  UpdateStaffDto,
} from './dto/staff-profile.dto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type StaffClassRow = {
  id: string;
  name: string;
  created_at: Date;
  codes: { code: string }[];
  _count: { memberships: number };
};

type StaffRow = {
  id: string;
  email: string | null;
  username: string | null;
  real_name: string | null;
  role: Role;
  status: UserStatus;
  settings_json: unknown;
  created_at: Date;
  classes_teaching: StaffClassRow[];
};

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async list(adminId: string, query: StaffListQueryDto) {
    const schoolId = await this.adminSchool(adminId);
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const q = query.q?.trim();
    const where: Prisma.UserWhereInput = {
      deleted_at: null,
      school_id: schoolId,
      role: { in: [Role.TEACHER, Role.ADMIN] },
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { real_name: { contains: q, mode: 'insensitive' } },
              { username: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: [{ real_name: 'asc' }, { email: 'asc' }],
        include: this.staffInclude(),
      }),
    ]);
    return {
      success: true,
      data: paginateResponse(
        rows.map((row) => this.toStaff(row as unknown as StaffRow)),
        total,
        page,
        perPage,
      ),
    };
  }

  async detail(adminId: string, staffId: string) {
    const schoolId = await this.adminSchool(adminId);
    const staff = await this.staffInSchool(staffId, schoolId);
    return { success: true, data: this.toStaff(staff) };
  }

  async invite(adminId: string, dto: InviteStaffDto) {
    const admin = await this.adminUser(adminId);
    const email = dto.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findFirst({
      where: { email, deleted_at: null },
    });
    if (existingUser) {
      throw new HttpException('Email is already in use', HttpStatus.CONFLICT);
    }
    const pending = await this.prisma.staffInvite.findFirst({
      where: {
        email,
        accepted_at: null,
        expires_at: { gt: new Date() },
      },
    });
    if (pending) {
      throw new HttpException('Invite already sent', HttpStatus.CONFLICT);
    }

    const token = randomBytes(32).toString('hex');
    const created = await this.prisma.staffInvite.create({
      data: {
        email,
        invited_by_id: admin.id,
        can_access_safe_space: dto.canAccessSafeSpace,
        token_hash: createHash('sha256').update(token).digest('hex'),
        expires_at: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    const url = `${appConfig().app.client_app_url ?? ''}/accept-invite?token=${encodeURIComponent(token)}`;
    await this.mailService.sendMemberInvitation({
      user: {
        fname: admin.real_name || admin.email || 'Admin',
        lname: '',
        email: admin.email,
      },
      member: {
        fname: email,
        email,
        token,
      },
      url,
    });

    return {
      success: true,
      message: 'Invite sent',
      data: {
        id: created.id,
        ...(process.env.NODE_ENV === 'production' ? {} : { devToken: token }),
      },
    };
  }

  async update(adminId: string, staffId: string, dto: UpdateStaffDto) {
    const schoolId = await this.adminSchool(adminId);
    const staff = await this.staffInSchool(staffId, schoolId);

    const nextEmail = dto.email?.trim().toLowerCase();
    if (nextEmail && nextEmail !== (staff.email ?? '').toLowerCase()) {
      const taken = await this.prisma.user.findFirst({
        where: { email: nextEmail, deleted_at: null, NOT: { id: staffId } },
      });
      if (taken) {
        throw new HttpException('Email is already in use', HttpStatus.CONFLICT);
      }
    }

    const prevSettings =
      staff.settings_json &&
      typeof staff.settings_json === 'object' &&
      !Array.isArray(staff.settings_json)
        ? (staff.settings_json as Record<string, Prisma.InputJsonValue>)
        : {};
    const settings: Prisma.InputJsonObject = {
      ...prevSettings,
      ...(dto.canAccessSafeSpace !== undefined
        ? { canAccessSafeSpace: dto.canAccessSafeSpace }
        : {}),
    };

    await this.prisma.user.update({
      where: { id: staffId },
      data: {
        real_name: dto.name.trim(),
        ...(nextEmail ? { email: nextEmail } : {}),
        settings_json: settings,
      },
    });

    if (dto.assignedClass?.trim()) {
      const label = dto.assignedClass.trim();
      const target = await this.prisma.class.findFirst({
        where: {
          school_id: schoolId,
          deleted_at: null,
          OR: [{ id: label }, { name: label }],
        },
      });
      if (target) {
        await this.prisma.class.updateMany({
          where: { teacher_id: staffId, NOT: { id: target.id } },
          data: { teacher_id: null },
        });
        await this.prisma.class.update({
          where: { id: target.id },
          data: { teacher_id: staffId },
        });
      }
    }

    const refreshed = await this.staffInSchool(staffId, schoolId);
    return {
      success: true,
      message: 'Staff updated',
      data: this.toStaff(refreshed),
    };
  }

  async reactivate(adminId: string, staffId: string) {
    const schoolId = await this.adminSchool(adminId);
    const staff = await this.staffInSchool(staffId, schoolId);
    if (staff.status === UserStatus.ACTIVE) {
      throw new HttpException('Staff is already active', HttpStatus.CONFLICT);
    }
    if (staff.status !== UserStatus.INACTIVE) {
      throw new HttpException('Staff is not inactive', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const updated = await this.prisma.user.update({
      where: { id: staff.id },
      data: { status: UserStatus.ACTIVE },
    });
    return {
      success: true,
      message: 'Staff reactivated',
      data: { id: updated.id, status: updated.status },
    };
  }

  async remind(adminId: string, staffId: string) {
    const schoolId = await this.adminSchool(adminId);
    const staff = await this.staffInSchool(staffId, schoolId);
    if (!staff.email) {
      throw new HttpException('Staff has no email', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const pending = await this.prisma.staffInvite.findFirst({
      where: {
        email: staff.email.toLowerCase(),
        accepted_at: null,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: 'desc' },
    });
    if (!pending) {
      throw new HttpException('No pending invite to remind', HttpStatus.NOT_FOUND);
    }

    const token = randomBytes(32).toString('hex');
    await this.prisma.staffInvite.update({
      where: { id: pending.id },
      data: {
        token_hash: createHash('sha256').update(token).digest('hex'),
        expires_at: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    const admin = await this.adminUser(adminId);
    const url = `${appConfig().app.client_app_url ?? ''}/accept-invite?token=${encodeURIComponent(token)}`;
    await this.mailService.sendMemberInvitation({
      user: {
        fname: admin.real_name || admin.email || 'Admin',
        lname: '',
        email: admin.email,
      },
      member: {
        fname: staff.real_name || staff.email,
        email: staff.email,
        token,
      },
      url,
    });

    return {
      success: true,
      message: 'Reminder sent',
      data: {
        id: pending.id,
        ...(process.env.NODE_ENV === 'production' ? {} : { devToken: token }),
      },
    };
  }

  private toStaff(row: StaffRow) {
    const settings =
      row.settings_json &&
      typeof row.settings_json === 'object' &&
      !Array.isArray(row.settings_json)
        ? (row.settings_json as { canAccessSafeSpace?: boolean })
        : {};
    const classes = (row.classes_teaching ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      code: item.codes[0]?.code ?? '',
      assignedOn: item.created_at.toISOString(),
      studentCount: item._count.memberships,
    }));
    const name =
      row.real_name?.trim() ||
      row.username?.trim() ||
      row.email?.split('@')[0] ||
      'Staff';
    const handle =
      row.username?.trim() ||
      row.email?.split('@')[0] ||
      row.id.slice(0, 8);
    return {
      id: row.id,
      name,
      handle,
      email: row.email ?? '',
      phone: '',
      staffCode: row.username?.trim() || row.id.slice(0, 8).toUpperCase(),
      role: row.role,
      canAccessSafeSpace: settings.canAccessSafeSpace === true,
      assignedClass: classes.map((c) => c.name).join(', '),
      studentCount: classes.reduce((sum, c) => sum + c.studentCount, 0),
      status: row.status,
      joinedAt: row.created_at.toISOString(),
      classes,
    };
  }

  private staffInclude() {
    return {
      classes_teaching: {
        where: { deleted_at: null },
        select: {
          id: true,
          name: true,
          created_at: true,
          codes: {
            where: { status: ClassCodeStatus.ACTIVE },
            select: { code: true },
            take: 1,
            orderBy: { created_at: 'desc' as const },
          },
          _count: { select: { memberships: true } },
        },
        orderBy: { name: 'asc' as const },
      },
    } satisfies Prisma.UserInclude;
  }

  private async adminSchool(userId: string) {
    const admin = await this.adminUser(userId);
    return admin.school_id as string;
  }

  private async adminUser(userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user || user.role !== Role.ADMIN) {
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

  private async staffInSchool(staffId: string, schoolId: string) {
    const staff = await this.prisma.user.findFirst({
      where: {
        id: staffId,
        school_id: schoolId,
        role: { in: [Role.TEACHER, Role.ADMIN] },
        deleted_at: null,
      },
      include: this.staffInclude(),
    });
    if (!staff) {
      throw new HttpException('Staff not found', HttpStatus.NOT_FOUND);
    }
    return staff as unknown as StaffRow;
  }
}
