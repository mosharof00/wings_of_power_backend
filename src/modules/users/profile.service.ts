import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { JoinRequestStatus, Prisma, Role } from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SettingsDto,
  UpdateStudentProfileDto,
  UpdateTeacherProfileDto,
} from './dto/staff-profile.dto';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async teacherProfile(userId: string) {
    const user = await this.self(userId, Role.TEACHER);
    const [classCount, studentCount] = await Promise.all([
      this.prisma.class.count({ where: { teacher_id: user.id } }),
      this.prisma.classMembership.count({
        where: {
          status: JoinRequestStatus.APPROVED,
          class: { teacher_id: user.id },
        },
      }),
    ]);
    return {
      success: true,
      data: {
        id: user.id,
        realName: user.real_name,
        email: user.email,
        status: user.status,
        avatarUrl: user.avatar_url,
        role: user.role,
        classCount,
        studentCount,
      },
    };
  }

  async updateTeacherProfile(userId: string, dto: UpdateTeacherProfileDto) {
    await this.self(userId, Role.TEACHER);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.realName ? { real_name: dto.realName.trim() } : {}),
      },
    });
    return {
      success: true,
      message: 'Profile updated',
      data: { id: updated.id, realName: updated.real_name },
    };
  }

  teacherSettings(userId: string) {
    return this.readSettings(userId, Role.TEACHER);
  }

  updateTeacherSettings(userId: string, dto: SettingsDto) {
    return this.writeSettings(userId, Role.TEACHER, dto);
  }

  async studentProfile(userId: string) {
    const user = await this.self(userId, Role.STUDENT);
    const [points, badges, membership] = await Promise.all([
      this.prisma.pointsLedger.aggregate({
        where: { user_id: user.id },
        _sum: { amount: true },
      }),
      this.prisma.studentBadge.count({ where: { user_id: user.id } }),
      this.prisma.classMembership.findFirst({
        where: { user_id: user.id, status: JoinRequestStatus.APPROVED },
        include: { class: true },
        orderBy: { updated_at: 'desc' },
      }),
    ]);
    return {
      success: true,
      data: {
        id: user.id,
        nickname: user.nickname,
        realName: user.real_name,
        avatarUrl: user.avatar_url,
        status: user.status,
        points: points._sum.amount ?? 0,
        badges,
        class: membership?.class
          ? { id: membership.class.id, name: membership.class.name }
          : null,
      },
    };
  }

  async updateStudentProfile(userId: string, dto: UpdateStudentProfileDto) {
    await this.self(userId, Role.STUDENT);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.nickname ? { nickname: dto.nickname.trim() } : {}),
        ...(dto.avatarUrl ? { avatar_url: dto.avatarUrl.trim() } : {}),
      },
    });
    return {
      success: true,
      message: 'Profile updated',
      data: {
        id: updated.id,
        nickname: updated.nickname,
        avatarUrl: updated.avatar_url,
      },
    };
  }

  studentSettings(userId: string) {
    return this.readSettings(userId, Role.STUDENT);
  }

  updateStudentSettings(userId: string, dto: SettingsDto) {
    return this.writeSettings(userId, Role.STUDENT, dto);
  }

  private async readSettings(userId: string, role: Role) {
    const user = await this.self(userId, role);
    return { success: true, data: asSettings(user.settings_json) };
  }

  private async writeSettings(userId: string, role: Role, dto: SettingsDto) {
    const user = await this.self(userId, role);
    const settings = mergeSettings(
      asSettings(user.settings_json),
      definedPatch(dto),
    );
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { settings_json: settings as Prisma.InputJsonValue },
    });
    return {
      success: true,
      message: 'Settings updated',
      data: asSettings(updated.settings_json),
    };
  }

  private async self(userId: string, role: Role) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deleted_at: null },
    });
    if (!user || user.role !== role) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    return user;
  }
}

function asSettings(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function definedPatch(dto: object): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(dto)) {
    if (value !== undefined) {
      patch[key] = value;
    }
  }
  return patch;
}

function mergeSettings(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const previous = next[key];
    if (isPlainObject(value) && isPlainObject(previous)) {
      next[key] = { ...previous, ...value };
      continue;
    }
    next[key] = value;
  }
  return next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
