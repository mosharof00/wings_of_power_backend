import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  KindnessCornerItem,
  MediaType,
  Prisma,
  PublishStatus,
  Role,
} from 'prisma/generated/client';
import { paginateResponse } from '../../common/pagination/pagination.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateKindnessItemDto,
  KindnessListQueryDto,
  UpdateKindnessItemDto,
} from './dto/kindness.dto';

@Injectable()
export class KindnessService {
  constructor(private readonly prisma: PrismaService) {}

  async list(adminId: string, query: Partial<KindnessListQueryDto> = {}) {
    const schoolId = await this.adminSchool(adminId);
    const page = query.page ?? 1;
    const perPage = query.perPage ?? query.limit ?? 10;
    const where: Prisma.KindnessCornerItemWhereInput = {
      deleted_at: null,
      school_id: schoolId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { title: { contains: query.search.trim(), mode: 'insensitive' } }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.kindnessCornerItem.count({ where }),
      this.prisma.kindnessCornerItem.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { created_at: 'desc' },
      }),
    ]);

    return {
      success: true,
      data: paginateResponse(
        rows.map((row) => this.toKindnessItem(row)),
        total,
        page,
        perPage,
      ),
    };
  }

  async get(adminId: string, id: string) {
    const schoolId = await this.adminSchool(adminId);
    const item = await this.itemInSchool(id, schoolId);
    return {
      success: true,
      data: this.toKindnessItem(item),
    };
  }

  async create(adminId: string, dto: CreateKindnessItemDto) {
    const schoolId = await this.adminSchool(adminId);

    if (!dto.title || typeof dto.title !== 'string' || !dto.title.trim()) {
      throw new HttpException('title is required', HttpStatus.BAD_REQUEST);
    }

    const mediaUrl = (dto.media_url || dto.mediaUrl)?.trim();
    if (!mediaUrl) {
      throw new HttpException('media_url is required', HttpStatus.BAD_REQUEST);
    }

    const mediaType = dto.media_type || dto.mediaType;
    if (!mediaType) {
      throw new HttpException('media_type is required', HttpStatus.BAD_REQUEST);
    }
    if (!Object.values(MediaType).includes(mediaType as MediaType)) {
      throw new HttpException(
        'media_type must be IMAGE or VIDEO',
        HttpStatus.BAD_REQUEST,
      );
    }

    const status = dto.status ?? PublishStatus.DRAFT;

    const item = await this.prisma.kindnessCornerItem.create({
      data: {
        school_id: schoolId,
        title: dto.title.trim(),
        media_url: mediaUrl,
        media_type: mediaType as MediaType,
        status,
      },
    });

    return {
      success: true,
      message: 'Kindness corner item created',
      data: this.toKindnessItem(item),
    };
  }

  async update(adminId: string, id: string, dto: UpdateKindnessItemDto) {
    const schoolId = await this.adminSchool(adminId);
    const item = await this.itemInSchool(id, schoolId);

    const mediaType = dto.media_type || dto.mediaType;
    if (
      mediaType &&
      !Object.values(MediaType).includes(mediaType as MediaType)
    ) {
      throw new HttpException(
        'media_type must be IMAGE or VIDEO',
        HttpStatus.BAD_REQUEST,
      );
    }

    const data: Prisma.KindnessCornerItemUpdateInput = {};
    if (dto.title !== undefined) {
      if (typeof dto.title !== 'string' || !dto.title.trim()) {
        throw new HttpException(
          'title cannot be empty',
          HttpStatus.BAD_REQUEST,
        );
      }
      data.title = dto.title.trim();
    }

    const mediaUrl = (dto.media_url || dto.mediaUrl)?.trim();
    if (mediaUrl !== undefined) {
      if (!mediaUrl) {
        throw new HttpException(
          'media_url cannot be empty',
          HttpStatus.BAD_REQUEST,
        );
      }
      data.media_url = mediaUrl;
    }

    if (mediaType !== undefined) {
      data.media_type = mediaType as MediaType;
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
    }

    const updated = await this.prisma.kindnessCornerItem.update({
      where: { id: item.id },
      data,
    });

    return {
      success: true,
      message: 'Kindness corner item updated',
      data: this.toKindnessItem(updated),
    };
  }

  async delete(adminId: string, id: string) {
    const schoolId = await this.adminSchool(adminId);
    const item = await this.itemInSchool(id, schoolId);

    const deleted = await this.prisma.kindnessCornerItem.update({
      where: { id: item.id },
      data: { deleted_at: new Date() },
    });

    return {
      success: true,
      message: 'Kindness corner item deleted',
      data: this.toKindnessItem(deleted),
    };
  }

  private async adminSchool(userId: string): Promise<string> {
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
    return user.school_id;
  }

  private async itemInSchool(
    id: string,
    schoolId: string,
  ): Promise<KindnessCornerItem> {
    const item = await this.prisma.kindnessCornerItem.findFirst({
      where: { id, deleted_at: null },
    });
    if (!item) {
      throw new HttpException(
        'Kindness corner item not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (item.school_id !== schoolId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    return item;
  }

  toKindnessItem(item: KindnessCornerItem) {
    return {
      id: item.id,
      school_id: item.school_id,
      schoolId: item.school_id,
      title: item.title,
      media_url: item.media_url,
      mediaUrl: item.media_url,
      media_type: item.media_type,
      mediaType: item.media_type,
      status: item.status,
      deleted_at: item.deleted_at,
      deletedAt: item.deleted_at,
      created_at: item.created_at,
      createdAt: item.created_at,
      updated_at: item.updated_at,
      updatedAt: item.updated_at,
    };
  }
}
