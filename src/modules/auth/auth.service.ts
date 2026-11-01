import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  AuthCodePurpose,
  ClassCodeStatus,
  JoinRequestStatus,
  Prisma,
  Role,
  User,
  UserStatus,
} from 'prisma/generated/client';
import appConfig from '../../config/app.config';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  RegisterAdminDto,
  ResetPasswordDto,
  SchoolProfileDto,
  StaffLoginDto,
  VerifyEmailDto,
} from './dto/staff-auth.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import {
  JoinCodeDto,
  RegisterStudentDto,
  SelectHeroDto,
  StudentLoginDto,
} from './dto/student-auth.dto';

const CODE_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly jwtService: JwtService,
  ) {}

  async registerAdmin(dto: RegisterAdminDto) {
    this.assertPasswordsMatch(dto.password, dto.confirmPassword);
    const email = normalizeEmail(dto.email);
    const existing = await this.prisma.user.findFirst({ where: { email } });
    if (existing) {
      throw new HttpException('Email already registered', HttpStatus.CONFLICT);
    }

    const password_hash = await bcrypt.hash(
      dto.password,
      appConfig().security.salt,
    );
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          password_hash,
          real_name: dto.name.trim(),
          role: Role.ADMIN,
          status: UserStatus.PENDING,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException(
          'Email already registered',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    const code = await this.issueCode(email, AuthCodePurpose.VERIFY_EMAIL);
    await this.mailService.sendOtpCodeToEmail({
      name: user.real_name,
      email,
      otp: code,
    });

    return {
      success: true,
      message: 'Check your email for a verification code',
      data: { user: toPublicUser(user) },
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findFirst({ where: { email } });
    const row = await this.findCode(
      email,
      AuthCodePurpose.VERIFY_EMAIL,
      dto.code,
    );
    if (!user || user.role !== Role.ADMIN || !row) {
      throw new HttpException(
        'Invalid or expired code',
        HttpStatus.BAD_REQUEST,
      );
    }

    const verifiedAt = new Date();
    await this.prisma.authCode.update({
      where: { id: row.id },
      data: { used_at: verifiedAt },
    });
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        status: UserStatus.ACTIVE,
        email_verified_at: verifiedAt,
      },
    });

    return {
      success: true,
      message: 'Email verified',
      data: { user: toPublicUser(updated) },
    };
  }

  async loginAdmin(dto: StaffLoginDto) {
    return this.login(dto, [Role.ADMIN]);
  }

  async loginStaff(dto: StaffLoginDto) {
    return this.login(dto, [Role.ADMIN, Role.TEACHER]);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findFirst({ where: { email } });
    if (user && (user.role === Role.ADMIN || user.role === Role.TEACHER)) {
      const code = await this.issueCode(email, AuthCodePurpose.RESET_PASSWORD);
      await this.mailService.sendOtpCodeToEmail({
        name: user.real_name,
        email,
        otp: code,
      });
    }

    return {
      success: true,
      message: 'If that account exists, a reset code is on its way',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    this.assertPasswordsMatch(dto.password, dto.confirmPassword);
    const row = await this.prisma.authCode.findFirst({
      where: {
        purpose: AuthCodePurpose.RESET_PASSWORD,
        code_hash: hashCode(dto.token),
      },
      orderBy: { created_at: 'desc' },
    });
    if (!row || row.used_at || row.expires_at.getTime() <= Date.now()) {
      throw new HttpException(
        'Invalid or expired code',
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { email: row.email },
    });
    if (!user || (user.role !== Role.ADMIN && user.role !== Role.TEACHER)) {
      throw new HttpException(
        'Invalid or expired code',
        HttpStatus.BAD_REQUEST,
      );
    }

    const password_hash = await bcrypt.hash(
      dto.password,
      appConfig().security.salt,
    );
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password_hash },
    });
    await this.prisma.authCode.update({
      where: { id: row.id },
      data: { used_at: new Date() },
    });

    return { success: true, message: 'Password updated' };
  }

  async createSchool(userId: string, dto: SchoolProfileDto) {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    if (user.role !== Role.ADMIN) {
      throw new HttpException('Admin only', HttpStatus.FORBIDDEN);
    }
    const existing = await this.prisma.school.findFirst();
    if (existing || user.school_id) {
      throw new HttpException('School already exists', HttpStatus.CONFLICT);
    }

    const school = await this.prisma.school.create({
      data: { name: dto.name.trim() },
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { school_id: school.id },
    });

    return {
      success: true,
      message: 'School saved',
      data: { id: school.id, name: school.name },
    };
  }

  async joinCode(dto: JoinCodeDto) {
    const resolved = await this.resolveClassCode(dto.code);
    if (resolved.kind === 'missing') {
      throw new HttpException('WRONG_CODE', HttpStatus.NOT_FOUND);
    }
    if (resolved.kind === 'expired') {
      throw new HttpException('EXPIRED_CODE', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return { success: true, data: this.classPreview(resolved.row) };
  }

  async registerStudent(dto: RegisterStudentDto) {
    this.assertPasswordsMatch(dto.password, dto.confirmPassword);
    const resolved = await this.resolveClassCode(dto.code);
    if (resolved.kind !== 'ok') {
      throw new HttpException(
        resolved.kind === 'missing' ? 'WRONG_CODE' : 'EXPIRED_CODE',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const username = dto.username.trim();
    const existing = await this.prisma.user.findFirst({ where: { username } });
    if (existing) {
      throw new HttpException(
        'Username already registered',
        HttpStatus.CONFLICT,
      );
    }

    const password_hash = await bcrypt.hash(
      dto.password,
      appConfig().security.salt,
    );
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          username,
          password_hash,
          nickname: dto.nickname.trim(),
          real_name: dto.realName.trim(),
          role: Role.STUDENT,
          status: UserStatus.PENDING,
          school_id: resolved.row.class.school_id,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException(
          'Username already registered',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    await this.prisma.classMembership.create({
      data: {
        class_id: resolved.row.class.id,
        user_id: user.id,
        status: JoinRequestStatus.PENDING,
        joined_via_code_id: resolved.row.id,
      },
    });

    return {
      success: true,
      message: 'Account pending approval',
      data: {
        user: toPublicUser(user),
        accessToken: await this.signToken(user),
      },
    };
  }

  async loginStudent(dto: StudentLoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { username: dto.username.trim() },
    });
    if (!user?.password_hash || user.role !== Role.STUDENT) {
      throw new HttpException(
        'Invalid username or password',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const matches = await bcrypt.compare(dto.password, user.password_hash);
    if (!matches) {
      throw new HttpException(
        'Invalid username or password',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new HttpException(user.status, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });
    return {
      success: true,
      data: {
        accessToken: await this.signToken(user),
        user: toPublicUser(user),
      },
    };
  }

  async selectHero(userId: string, dto: SelectHeroDto) {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    if (user.role !== Role.STUDENT) {
      throw new HttpException('Student only', HttpStatus.FORBIDDEN);
    }

    const hero = await this.prisma.hero.findFirst({
      where: { id: dto.heroId },
    });
    if (!hero) {
      throw new HttpException('Hero not found', HttpStatus.NOT_FOUND);
    }
    const unlock = await this.prisma.studentHeroUnlock.findFirst({
      where: { user_id: user.id, hero_id: hero.id },
    });
    if (hero.unlock_stories_required !== 0 && !unlock) {
      throw new HttpException('Hero is locked', HttpStatus.FORBIDDEN);
    }
    if (!unlock) {
      await this.prisma.studentHeroUnlock.create({
        data: { user_id: user.id, hero_id: hero.id },
      });
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { selected_hero_id: hero.id },
    });
    return this.me(user.id);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      include: {
        school: true,
        selected_hero: true,
        memberships: {
          include: { class: true },
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
    });
    if (!user) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const membership = user.memberships[0] ?? null;
    return {
      success: true,
      data: {
        ...toPublicUser(user),
        school: user.school
          ? { id: user.school.id, name: user.school.name }
          : null,
        class: membership
          ? {
              membershipId: membership.id,
              classId: membership.class_id,
              className: membership.class.name,
              status: membership.status,
            }
          : null,
        hero: user.selected_hero
          ? {
              id: user.selected_hero.id,
              code: user.selected_hero.code,
              displayName: user.selected_hero.display_name,
            }
          : null,
      },
    };
  }

  async acceptInvite(dto: AcceptInviteDto) {
    this.assertPasswordsMatch(dto.password, dto.confirmPassword);
    const tokenHash = hashCode(dto.token);
    const invite = await this.prisma.staffInvite.findFirst({
      where: { token_hash: tokenHash },
      include: { invited_by: true },
    });
    if (
      !invite ||
      invite.accepted_at ||
      invite.expires_at.getTime() <= Date.now() ||
      !hashesEqual(invite.token_hash, tokenHash)
    ) {
      throw new HttpException(
        'Invalid or expired invite',
        HttpStatus.BAD_REQUEST,
      );
    }

    const password_hash = await bcrypt.hash(
      dto.password,
      appConfig().security.salt,
    );
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          email: invite.email,
          password_hash,
          real_name: dto.name.trim(),
          role: Role.TEACHER,
          status: UserStatus.ACTIVE,
          school_id: invite.invited_by.school_id,
          settings_json: {
            canAccessSafeSpace: invite.can_access_safe_space,
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException(
          'Email already registered',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    await this.prisma.staffInvite.update({
      where: { id: invite.id },
      data: { accepted_at: new Date() },
    });

    return {
      success: true,
      message: 'Invite accepted',
      data: { user: toPublicUser(user) },
    };
  }

  logout() {
    return { success: true, message: 'Logged out' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user || !user.password_hash) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    const matches = await bcrypt.compare(dto.current, user.password_hash);
    if (!matches) {
      throw new HttpException(
        'Current password is wrong',
        HttpStatus.BAD_REQUEST,
      );
    }
    const password_hash = await bcrypt.hash(
      dto.next,
      appConfig().security.salt,
    );
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password_hash },
    });
    return { success: true, message: 'Password updated' };
  }

  async validateStaffCredentials(email: string, password: string) {
    return this.assertCanLogin(email, password, [Role.ADMIN, Role.TEACHER]);
  }

  private async login(dto: StaffLoginDto, roles: Role[]) {
    const user = await this.assertCanLogin(dto.email, dto.password, roles);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });
    return {
      success: true,
      data: {
        accessToken: await this.signToken(user),
        user: toPublicUser(user),
      },
    };
  }

  private signToken(user: User) {
    return this.jwtService.signAsync({
      sub: user.id,
      role: user.role,
      status: user.status,
      schoolId: user.school_id,
    });
  }

  private async resolveClassCode(raw: string) {
    const row = await this.prisma.classCode.findFirst({
      where: { code: raw.trim() },
      include: { class: { include: { teacher: true } } },
    });
    if (!row) {
      return { kind: 'missing' as const };
    }
    const past =
      row.expires_at != null && row.expires_at.getTime() <= Date.now();
    if (row.status !== ClassCodeStatus.ACTIVE || past) {
      return { kind: 'expired' as const };
    }
    return { kind: 'ok' as const, row };
  }

  private classPreview(row: {
    class: {
      id: string;
      name: string;
      teacher: { real_name: string | null; nickname: string | null } | null;
    };
  }) {
    return {
      className: row.class.name,
      teacherName:
        row.class.teacher?.real_name ?? row.class.teacher?.nickname ?? null,
      classId: row.class.id,
    };
  }

  private async assertCanLogin(email: string, password: string, roles: Role[]) {
    const user = await this.prisma.user.findFirst({
      where: { email: normalizeEmail(email) },
    });
    if (!user?.password_hash) {
      throw new HttpException(
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const matches = await bcrypt.compare(password, user.password_hash);
    const allowed =
      matches && roles.includes(user.role) && user.status === UserStatus.ACTIVE;
    if (!allowed) {
      throw new HttpException(
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return user;
  }

  private async issueCode(email: string, purpose: AuthCodePurpose) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.authCode.create({
      data: {
        email,
        purpose,
        code_hash: hashCode(code),
        expires_at: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    return code;
  }

  private async findCode(
    email: string,
    purpose: AuthCodePurpose,
    code: string,
  ) {
    const row = await this.prisma.authCode.findFirst({
      where: { email, purpose, code_hash: hashCode(code) },
      orderBy: { created_at: 'desc' },
    });
    if (!row || row.used_at || row.expires_at.getTime() <= Date.now()) {
      return null;
    }
    if (!hashesEqual(row.code_hash, hashCode(code))) {
      return null;
    }
    return row;
  }

  private assertPasswordsMatch(password: string, confirmPassword: string) {
    if (password !== confirmPassword) {
      throw new HttpException('Passwords do not match', HttpStatus.BAD_REQUEST);
    }
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashCode(code: string) {
  return createHash('sha256').update(code).digest('hex');
}

function hashesEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    name: user.real_name,
    username: user.username,
    nickname: user.nickname,
    schoolId: user.school_id,
  };
}
