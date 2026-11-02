import { Injectable } from '@nestjs/common';
import { Notification } from 'prisma/generated/client';
import { paginateResponse } from '../../common/pagination/pagination.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateNotificationDto,
  NotificationQueryDto,
  NotificationResponseDto,
} from './dto/notification.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listStudentNotifications(userId: string, query?: NotificationQueryDto) {
    const page = Math.max(1, Number(query?.page) || 1);
    const perPage = Math.max(1, Math.min(100, Number(query?.perPage) || 10));
    const skip = (page - 1) * perPage;

    const where = {
      user_id: userId,
      deleted_at: null,
    };

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: perPage,
      }),
      this.prisma.notification.count({ where }),
    ]);

    const serializedItems = items.map((item) => this.serialize(item));

    return {
      success: true,
      data: paginateResponse(serializedItems, total, page, perPage),
    };
  }

  async create(dto: CreateNotificationDto): Promise<NotificationResponseDto> {
    const created = await this.prisma.notification.create({
      data: {
        user_id: dto.userId,
        type: dto.type,
        title: dto.title,
        body: dto.body ?? null,
        ...(dto.data !== undefined ? { data_json: dto.data } : {}),
      },
    });

    return this.serialize(created);
  }

  private serialize(notification: Notification): NotificationResponseDto {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body ?? null,
      data: notification.data_json ?? null,
      readAt: notification.read_at ?? null,
      createdAt: notification.created_at,
    };
  }
}
