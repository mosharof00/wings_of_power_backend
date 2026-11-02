import {
  BadRequestException,
  ExecutionContext,
  HttpException,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MediaType, PublishStatus, Role } from 'prisma/generated/client';
import { Role as GuardRole } from '../../common/guard/role/role.enum';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { UserRepository } from '../../common/repository/user/user.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminKindnessController } from './admin-kindness.controller';
import {
  CreateKindnessItemDto,
  UpdateKindnessItemDto,
} from './dto/kindness.dto';
import { KindnessService } from './kindness.service';

describe('KindnessService', () => {
  const prisma = {
    user: { findFirst: jest.fn() },
    kindnessCornerItem: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const service = new KindnessService(prisma as unknown as PrismaService);

  const adminUser = {
    id: 'admin-1',
    role: Role.ADMIN,
    school_id: 'school-1',
  };

  const teacherUser = {
    id: 'teacher-1',
    role: Role.TEACHER,
    school_id: 'school-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('RBAC & Teacher 403', () => {
    it('teacher token is 403 via RolesGuard', async () => {
      const reflector = new Reflector();
      const users = {
        getUserDetails: jest
          .fn()
          .mockResolvedValue({ role: GuardRole.TEACHER }),
      };
      const guard = new RolesGuard(
        reflector,
        users as unknown as UserRepository,
      );
      const context = {
        getHandler: () => AdminKindnessController.prototype.list,
        getClass: () => AdminKindnessController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { userId: 'teacher-1' } }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(
        new HttpException('Forbidden', HttpStatus.FORBIDDEN),
      );
    });

    it('teacher user is 403 via KindnessService', async () => {
      prisma.user.findFirst.mockResolvedValue(teacherUser);

      await expect(service.list('teacher-1', {})).rejects.toThrow(
        new HttpException('Forbidden', HttpStatus.FORBIDDEN),
      );

      await expect(
        service.create('teacher-1', {
          title: 'Kindness Post',
          media_url: 'https://cdn.example.com/pic.jpg',
          media_type: MediaType.IMAGE,
        }),
      ).rejects.toThrow(new HttpException('Forbidden', HttpStatus.FORBIDDEN));
    });

    it('admin without school setup throws 422', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'admin-no-school',
        role: Role.ADMIN,
        school_id: null,
      });

      await expect(service.list('admin-no-school', {})).rejects.toThrow(
        new HttpException(
          'School is not set up',
          HttpStatus.UNPROCESSABLE_ENTITY,
        ),
      );
    });
  });

  describe('Validation: media_type outside IMAGE/VIDEO -> 400', () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });

    it('rejects invalid media_type on create DTO with 400', async () => {
      await expect(
        pipe.transform(
          {
            title: 'Friendly Act',
            media_url: 'https://cdn.example.com/media.mp3',
            media_type: 'AUDIO',
          },
          { type: 'body', metatype: CreateKindnessItemDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid media_type on update DTO with 400', async () => {
      await expect(
        pipe.transform(
          { media_type: 'INVALID_TYPE' },
          { type: 'body', metatype: UpdateKindnessItemDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid media_type directly in service.create with 400', async () => {
      prisma.user.findFirst.mockResolvedValue(adminUser);

      await expect(
        service.create('admin-1', {
          title: 'Invalid Media Act',
          media_url: 'https://cdn.example.com/audio.mp3',
          media_type: 'PODCAST' as any,
        }),
      ).rejects.toThrow(
        new HttpException(
          'media_type must be IMAGE or VIDEO',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('rejects invalid media_type directly in service.update with 400', async () => {
      prisma.user.findFirst.mockResolvedValue(adminUser);
      prisma.kindnessCornerItem.findFirst.mockResolvedValue({
        id: 'item-1',
        school_id: 'school-1',
        title: 'Original Title',
        media_url: 'https://cdn.example.com/pic.jpg',
        media_type: MediaType.IMAGE,
        status: PublishStatus.DRAFT,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await expect(
        service.update('admin-1', 'item-1', {
          media_type: 'DOCUMENT' as any,
        }),
      ).rejects.toThrow(
        new HttpException(
          'media_type must be IMAGE or VIDEO',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('rejects missing title or media_url on create with 400', async () => {
      prisma.user.findFirst.mockResolvedValue(adminUser);

      await expect(
        service.create('admin-1', {
          title: '',
          media_url: 'https://cdn.example.com/pic.jpg',
          media_type: MediaType.IMAGE,
        }),
      ).rejects.toThrow(
        new HttpException('title is required', HttpStatus.BAD_REQUEST),
      );

      await expect(
        service.create('admin-1', {
          title: 'Valid Title',
          media_url: '',
          media_type: MediaType.IMAGE,
        }),
      ).rejects.toThrow(
        new HttpException('media_url is required', HttpStatus.BAD_REQUEST),
      );
    });
  });

  describe('Lifecycle: create draft, patch to PUBLISHED, list shows it', () => {
    it('creates as DRAFT, patches to PUBLISHED, and list returns it', async () => {
      prisma.user.findFirst.mockResolvedValue(adminUser);

      // 1. Create item (defaults to DRAFT)
      const mockCreated = {
        id: 'kindness-1',
        school_id: 'school-1',
        title: 'Sharing is Caring',
        media_url: 'https://cdn.example.com/photo.jpg',
        media_type: MediaType.IMAGE,
        status: PublishStatus.DRAFT,
        deleted_at: null,
        created_at: new Date('2026-11-01T10:00:00Z'),
        updated_at: new Date('2026-11-01T10:00:00Z'),
      };
      prisma.kindnessCornerItem.create.mockResolvedValue(mockCreated);

      const createRes = await service.create('admin-1', {
        title: 'Sharing is Caring',
        media_url: 'https://cdn.example.com/photo.jpg',
        media_type: MediaType.IMAGE,
      });

      expect(createRes.success).toBe(true);
      expect(createRes.data.status).toBe(PublishStatus.DRAFT);
      expect(createRes.data.title).toBe('Sharing is Caring');
      expect(prisma.kindnessCornerItem.create).toHaveBeenCalledWith({
        data: {
          school_id: 'school-1',
          title: 'Sharing is Caring',
          media_url: 'https://cdn.example.com/photo.jpg',
          media_type: MediaType.IMAGE,
          status: PublishStatus.DRAFT,
        },
      });

      // 2. Patch to PUBLISHED
      prisma.kindnessCornerItem.findFirst.mockResolvedValue(mockCreated);
      const mockPublished = {
        ...mockCreated,
        status: PublishStatus.PUBLISHED,
        updated_at: new Date('2026-11-01T11:00:00Z'),
      };
      prisma.kindnessCornerItem.update.mockResolvedValue(mockPublished);

      const patchRes = await service.update('admin-1', 'kindness-1', {
        status: PublishStatus.PUBLISHED,
      });

      expect(patchRes.success).toBe(true);
      expect(patchRes.data.status).toBe(PublishStatus.PUBLISHED);
      expect(prisma.kindnessCornerItem.update).toHaveBeenCalledWith({
        where: { id: 'kindness-1' },
        data: { status: PublishStatus.PUBLISHED },
      });

      // 3. List shows the published item
      prisma.kindnessCornerItem.count.mockResolvedValue(1);
      prisma.kindnessCornerItem.findMany.mockResolvedValue([mockPublished]);

      const listRes = await service.list('admin-1', {
        page: 1,
        perPage: 10,
        status: PublishStatus.PUBLISHED,
      });

      expect(listRes.success).toBe(true);
      expect(listRes.data.total).toBe(1);
      expect(listRes.data.items).toHaveLength(1);
      expect(listRes.data.items[0].id).toBe('kindness-1');
      expect(listRes.data.items[0].status).toBe(PublishStatus.PUBLISHED);
      expect(prisma.kindnessCornerItem.findMany).toHaveBeenCalledWith({
        where: {
          deleted_at: null,
          school_id: 'school-1',
          status: PublishStatus.PUBLISHED,
        },
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
      });
    });
  });

  describe('Delete: soft delete hides item from list', () => {
    it('sets deleted_at, hides it from subsequent list queries and detail lookups', async () => {
      prisma.user.findFirst.mockResolvedValue(adminUser);

      const existingItem = {
        id: 'kindness-del-1',
        school_id: 'school-1',
        title: 'Delete Target',
        media_url: 'https://cdn.example.com/video.mp4',
        media_type: MediaType.VIDEO,
        status: PublishStatus.PUBLISHED,
        deleted_at: null,
        created_at: new Date('2026-11-01T08:00:00Z'),
        updated_at: new Date('2026-11-01T08:00:00Z'),
      };

      prisma.kindnessCornerItem.findFirst.mockResolvedValue(existingItem);
      const deletedAt = new Date('2026-11-02T12:00:00Z');
      prisma.kindnessCornerItem.update.mockResolvedValue({
        ...existingItem,
        deleted_at: deletedAt,
      });

      // 1. Soft-delete the item
      const deleteRes = await service.delete('admin-1', 'kindness-del-1');
      expect(deleteRes.success).toBe(true);
      expect(prisma.kindnessCornerItem.update).toHaveBeenCalledWith({
        where: { id: 'kindness-del-1' },
        data: { deleted_at: expect.any(Date) },
      });

      // 2. Listing queries filter with deleted_at: null
      prisma.kindnessCornerItem.count.mockResolvedValue(0);
      prisma.kindnessCornerItem.findMany.mockResolvedValue([]);

      const listRes = await service.list('admin-1', {});
      expect(listRes.success).toBe(true);
      expect(listRes.data.total).toBe(0);
      expect(listRes.data.items).toEqual([]);
      expect(prisma.kindnessCornerItem.findMany).toHaveBeenCalledWith({
        where: {
          deleted_at: null,
          school_id: 'school-1',
        },
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
      });

      // 3. Trying to get/update the deleted item throws 404
      prisma.kindnessCornerItem.findFirst.mockResolvedValue(null);
      await expect(service.get('admin-1', 'kindness-del-1')).rejects.toThrow(
        new HttpException(
          'Kindness corner item not found',
          HttpStatus.NOT_FOUND,
        ),
      );
    });

    it('cross-school access is rejected with 403', async () => {
      prisma.user.findFirst.mockResolvedValue(adminUser);
      prisma.kindnessCornerItem.findFirst.mockResolvedValue({
        id: 'other-school-item',
        school_id: 'school-OTHER',
        title: 'Other School Item',
        media_url: 'https://cdn.example.com/other.jpg',
        media_type: MediaType.IMAGE,
        status: PublishStatus.PUBLISHED,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await expect(service.get('admin-1', 'other-school-item')).rejects.toThrow(
        new HttpException('Forbidden', HttpStatus.FORBIDDEN),
      );
    });
  });
});
