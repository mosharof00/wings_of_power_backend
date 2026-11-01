import { createHash, randomBytes } from 'crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Role, UserStatus } from 'prisma/generated/client';
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
    const where = {
      deleted_at: null,
      school_id: schoolId,
      role: { in: [Role.TEACHER, Role.ADMIN] },
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: [{ real_name: 'asc' }, { email: 'asc' }],
        include: {
          classes_teaching: { select: { id: true, name: true } },
        },
      }),
    ]);
    return {
      success: true,
      data: paginateResponse(
        rows.map((row) => this.toStaff(row)),
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
    await this.staffInSchool(staffId, schoolId);
    const updated = await this.prisma.user.update({
      where: { id: staffId },
      data: { real_name: dto.realName.trim() },
    });
    return {
      success: true,
      message: 'Staff updated',
      data: { id: updated.id, realName: updated.real_name },
    };
  }

  async reactivate(adminId: string, staffId: string) {
    const schoolId = await this.adminSchool(adminId);
    const staff = await this.staffInSchool(staffId, schoolId);
    if (staff.status === UserStatus.ACTIVE) {
      throw new HttpException('Staff is already active', HttpStatus.CONFLICT);
    }
    if (staff.status !== UserStatus.INACTIVE) {
      throw new HttpException('Staff is not inactive', HttpStatus.CONFLICT);
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

  private toStaff(row: {
    id: string;
    email: string | null;
    real_name: string | null;
    role: Role;
    status: UserStatus;
    settings_json: unknown;
    classes_teaching?: { id: string; name: string }[];
  }) {
    const settings =
      row.settings_json &&
      typeof row.settings_json === 'object' &&
      !Array.isArray(row.settings_json)
        ? (row.settings_json as { canAccessSafeSpace?: boolean })
        : {};
    return {
      id: row.id,
      email: row.email,
      realName: row.real_name,
      role: row.role,
      status: row.status,
      canAccessSafeSpace: settings.canAccessSafeSpace === true,
      classes: (row.classes_teaching ?? []).map((item) => ({
        id: item.id,
        name: item.name,
      })),
    };
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
      include: {
        classes_teaching: { select: { id: true, name: true } },
      },
    });
    if (!staff) {
      throw new HttpException('Staff not found', HttpStatus.NOT_FOUND);
    }
    return staff;
  }
}
