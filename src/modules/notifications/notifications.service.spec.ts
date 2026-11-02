import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from 'prisma/generated/client';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { UserRepository } from '../../common/repository/user/user.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { StudentNotificationsController } from './student-notifications.controller';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let controller: StudentNotificationsController;
  let prisma: {
    notification: {
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
    };
  };

  const sampleDate = new Date('2026-11-01T12:00:00Z');
  const readDate = new Date('2026-11-01T13:00:00Z');

  beforeEach(() => {
    prisma = {
      notification: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
    };

    service = new NotificationsService(prisma as unknown as PrismaService);
    controller = new StudentNotificationsController(service);
  });

  describe('listStudentNotifications', () => {
    it('list returns only the caller’s rows', async () => {
      const callerId = 'student-1';
      const mockNotifications = [
        {
          id: 'notif-1',
          user_id: callerId,
          type: 'BADGE_EARNED',
          title: 'Kindness Star',
          body: 'You earned a badge!',
          data_json: { badgeId: 'badge-123' },
          read_at: readDate,
          deleted_at: null,
          created_at: sampleDate,
          updated_at: sampleDate,
        },
      ];

      prisma.notification.findMany.mockResolvedValue(mockNotifications);
      prisma.notification.count.mockResolvedValue(1);

      const result = await service.listStudentNotifications(callerId, {
        page: 1,
        perPage: 10,
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: {
          user_id: callerId,
          deleted_at: null,
        },
        orderBy: { created_at: 'desc' },
        skip: 0,
        take: 10,
      });
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: {
          user_id: callerId,
          deleted_at: null,
        },
      });

      expect(result.success).toBe(true);
      expect(result.data.items).toEqual([
        {
          id: 'notif-1',
          type: 'BADGE_EARNED',
          title: 'Kindness Star',
          body: 'You earned a badge!',
          data: { badgeId: 'badge-123' },
          readAt: readDate,
          createdAt: sampleDate,
        },
      ]);
      expect(result.data.total).toBe(1);
      expect(result.data.page).toBe(1);
      expect(result.data.perPage).toBe(10);
      expect(result.data.lastPage).toBe(1);
    });

    it('soft-deleted rows are hidden', async () => {
      const callerId = 'student-1';

      prisma.notification.findMany.mockImplementation(async ({ where }) => {
        expect(where.deleted_at).toBeNull();
        expect(where.user_id).toBe(callerId);
        return [];
      });
      prisma.notification.count.mockImplementation(async ({ where }) => {
        expect(where.deleted_at).toBeNull();
        return 0;
      });

      const result = await service.listStudentNotifications(callerId, {
        page: 1,
        perPage: 10,
      });

      expect(result.data.items).toEqual([]);
      expect(result.data.total).toBe(0);
    });

    it('handles pagination parameters correctly', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(25);

      const result = await service.listStudentNotifications('student-1', {
        page: 2,
        perPage: 5,
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: {
          user_id: 'student-1',
          deleted_at: null,
        },
        orderBy: { created_at: 'desc' },
        skip: 5,
        take: 5,
      });
      expect(result.data.total).toBe(25);
      expect(result.data.page).toBe(2);
      expect(result.data.perPage).toBe(5);
      expect(result.data.lastPage).toBe(5);
    });

    it('defaults pagination when query is not provided', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(0);

      await service.listStudentNotifications('student-1');

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: {
          user_id: 'student-1',
          deleted_at: null,
        },
        orderBy: { created_at: 'desc' },
        skip: 0,
        take: 10,
      });
    });
  });

  describe('create', () => {
    it('create inserts type and title', async () => {
      const createdRow = {
        id: 'notif-created-1',
        user_id: 'student-1',
        type: 'POINTS_AWARDED',
        title: 'Kindness Points Awarded',
        body: 'Teacher awarded 10 points',
        data_json: { points: 10, reason: 'Helping classmate' },
        read_at: null,
        deleted_at: null,
        created_at: sampleDate,
        updated_at: sampleDate,
      };

      prisma.notification.create.mockResolvedValue(createdRow);

      const result = await service.create({
        userId: 'student-1',
        type: 'POINTS_AWARDED',
        title: 'Kindness Points Awarded',
        body: 'Teacher awarded 10 points',
        data: { points: 10, reason: 'Helping classmate' },
      });

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          user_id: 'student-1',
          type: 'POINTS_AWARDED',
          title: 'Kindness Points Awarded',
          body: 'Teacher awarded 10 points',
          data_json: { points: 10, reason: 'Helping classmate' },
        },
      });

      expect(result).toEqual({
        id: 'notif-created-1',
        type: 'POINTS_AWARDED',
        title: 'Kindness Points Awarded',
        body: 'Teacher awarded 10 points',
        data: { points: 10, reason: 'Helping classmate' },
        readAt: null,
        createdAt: sampleDate,
      });
    });

    it('create works with optional body and data omitted', async () => {
      const createdRow = {
        id: 'notif-created-2',
        user_id: 'student-2',
        type: 'SYSTEM_ANNOUNCEMENT',
        title: 'System Update',
        body: null,
        data_json: null,
        read_at: null,
        deleted_at: null,
        created_at: sampleDate,
        updated_at: sampleDate,
      };

      prisma.notification.create.mockResolvedValue(createdRow);

      const result = await service.create({
        userId: 'student-2',
        type: 'SYSTEM_ANNOUNCEMENT',
        title: 'System Update',
      });

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          user_id: 'student-2',
          type: 'SYSTEM_ANNOUNCEMENT',
          title: 'System Update',
          body: null,
        },
      });

      expect(result).toEqual({
        id: 'notif-created-2',
        type: 'SYSTEM_ANNOUNCEMENT',
        title: 'System Update',
        body: null,
        data: null,
        readAt: null,
        createdAt: sampleDate,
      });
    });
  });

  describe('RBAC & RolesGuard', () => {
    it('another role (TEACHER) -> 403 via RolesGuard', async () => {
      const reflector = new Reflector();
      const users = {
        getUserDetails: jest.fn().mockResolvedValue({ role: Role.TEACHER }),
      };
      const guard = new RolesGuard(
        reflector,
        users as unknown as UserRepository,
      );
      const context = {
        getHandler: () => StudentNotificationsController.prototype.list,
        getClass: () => StudentNotificationsController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { userId: 'teacher-1' } }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(
        new HttpException('Forbidden', HttpStatus.FORBIDDEN),
      );
    });

    it('another role (ADMIN) -> 403 via RolesGuard', async () => {
      const reflector = new Reflector();
      const users = {
        getUserDetails: jest.fn().mockResolvedValue({ role: Role.ADMIN }),
      };
      const guard = new RolesGuard(
        reflector,
        users as unknown as UserRepository,
      );
      const context = {
        getHandler: () => StudentNotificationsController.prototype.list,
        getClass: () => StudentNotificationsController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { userId: 'admin-1' } }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(
        new HttpException('Forbidden', HttpStatus.FORBIDDEN),
      );
    });

    it('allows STUDENT role through RolesGuard', async () => {
      const reflector = new Reflector();
      const users = {
        getUserDetails: jest.fn().mockResolvedValue({ role: Role.STUDENT }),
      };
      const guard = new RolesGuard(
        reflector,
        users as unknown as UserRepository,
      );
      const context = {
        getHandler: () => StudentNotificationsController.prototype.list,
        getClass: () => StudentNotificationsController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { userId: 'student-1' } }),
        }),
      } as unknown as ExecutionContext;

      const allowed = await guard.canActivate(context);
      expect(allowed).toBe(true);
    });
  });

  describe('StudentNotificationsController', () => {
    it('controller delegates list to service', async () => {
      const listSpy = jest
        .spyOn(service, 'listStudentNotifications')
        .mockResolvedValue({
          success: true,
          data: {
            items: [],
            total: 0,
            page: 1,
            perPage: 10,
            lastPage: 0,
          },
        });

      const res = await controller.list('student-1', { page: 1, perPage: 10 });
      expect(listSpy).toHaveBeenCalledWith('student-1', {
        page: 1,
        perPage: 10,
      });
      expect(res.success).toBe(true);
    });
  });
});
