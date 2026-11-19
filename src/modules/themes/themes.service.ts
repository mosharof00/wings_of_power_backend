import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, Role } from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateThemeDto, UpdateThemeDto } from './dto/theme.dto';

@Injectable()
export class ThemesService {
  constructor(private readonly prisma: PrismaService) {}

  async listAdmin() {
    await this.assertAdmin();
    const rows = await this.prisma.storyTheme.findMany({
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { stories: true } } },
    });
    return {
      success: true,
      data: rows.map((row) => this.toTheme(row, row._count.stories)),
    };
  }

  async listActive() {
    const rows = await this.prisma.storyTheme.findMany({
      where: { is_active: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });
    return {
      success: true,
      data: rows.map((row) => this.toTheme(row)),
    };
  }

  async create(adminId: string, dto: CreateThemeDto) {
    await this.assertAdmin(adminId);
    const name = dto.name.trim();
    const slug = this.slugify(dto.slug?.trim() || name);
    try {
      const created = await this.prisma.storyTheme.create({
        data: {
          name,
          slug,
          cover_url: dto.coverUrl?.trim() || null,
          sort_order: dto.sortOrder ?? 100,
          is_active: true,
        },
      });
      return {
        success: true,
        message: 'Theme created',
        data: this.toTheme(created, 0),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException('Theme slug already exists', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async update(adminId: string, id: string, dto: UpdateThemeDto) {
    await this.assertAdmin(adminId);
    await this.requireTheme(id);
    try {
      const updated = await this.prisma.storyTheme.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.slug !== undefined ? { slug: this.slugify(dto.slug) } : {}),
          ...(dto.coverUrl !== undefined
            ? { cover_url: dto.coverUrl?.trim() || null }
            : {}),
          ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
        },
        include: { _count: { select: { stories: true } } },
      });
      return {
        success: true,
        message: 'Theme updated',
        data: this.toTheme(updated, updated._count.stories),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException('Theme slug already exists', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async deactivate(adminId: string, id: string) {
    await this.assertAdmin(adminId);
    await this.requireTheme(id);
    const updated = await this.prisma.storyTheme.update({
      where: { id },
      data: { is_active: false },
      include: { _count: { select: { stories: true } } },
    });
    return {
      success: true,
      message: 'Theme deactivated',
      data: this.toTheme(updated, updated._count.stories),
    };
  }

  private async requireTheme(id: string) {
    const theme = await this.prisma.storyTheme.findFirst({ where: { id } });
    if (!theme) {
      throw new HttpException('Theme not found', HttpStatus.NOT_FOUND);
    }
    return theme;
  }

  private async assertAdmin(userId?: string) {
    if (!userId) return;
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user || user.role !== Role.ADMIN) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
  }

  private slugify(value: string) {
    const slug = value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug) {
      throw new HttpException('Theme slug is required', HttpStatus.BAD_REQUEST);
    }
    return slug;
  }

  private toTheme(
    row: {
      id: string;
      name: string;
      slug: string;
      cover_url: string | null;
      sort_order: number;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    },
    storyCount?: number,
  ) {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      coverUrl: row.cover_url,
      sortOrder: row.sort_order,
      isActive: row.is_active,
      storyCount: storyCount ?? undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
