import { Role } from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileService } from './profile.service';

describe('ProfileService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    class: { count: jest.fn() },
    classMembership: { count: jest.fn(), findFirst: jest.fn() },
    pointsLedger: { aggregate: jest.fn() },
    studentBadge: { count: jest.fn() },
    chapter: { count: jest.fn() },
    chapterProgress: { count: jest.fn() },
  };
  const service = new ProfileService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findFirst.mockReset();
    prisma.pointsLedger.aggregate.mockResolvedValue({ _sum: { amount: 75 } });
    prisma.studentBadge.count.mockResolvedValue(2);
    prisma.classMembership.findFirst.mockResolvedValue(null);
  });

  it('student nickname patch updates only the signed-in user', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'student-1',
      role: Role.STUDENT,
    });
    prisma.user.update.mockResolvedValue({
      id: 'student-1',
      nickname: 'Ace',
      avatar_url: 'assets/images/avatar_02.png',
      age: 9,
      school_id: 'school-1',
    });
    prisma.classMembership.findFirst.mockResolvedValue({
      class: { id: 'class-1', name: 'Room 10' },
    });
    prisma.chapter.count.mockResolvedValue(8);
    prisma.chapterProgress.count.mockResolvedValue(3);

    const result = await service.updateStudentProfile('student-1', {
      nickname: 'Ace',
    });
    expect(result.data).toMatchObject({
      nickname: 'Ace',
      avatarUrl: 'assets/images/avatar_02.png',
      points: 75,
      badges: 2,
      age: 9,
      progressPercent: 38,
      class: { id: 'class-1', name: 'Room 10' },
    });
    expect(prisma.chapter.count).toHaveBeenCalledWith({
      where: {
        deleted_at: null,
        story: { school_id: 'school-1', deleted_at: null, status: 'PUBLISHED' },
      },
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'student-1' },
      data: { nickname: 'Ace' },
    });
    expect(prisma.user.update.mock.calls[0][0].where.id).not.toBe('student-2');
  });

  it('settings merge does not wipe keys that were not sent', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'student-1',
      role: Role.STUDENT,
      settings_json: {
        read_to_me: true,
        sound: true,
        notifications: { stories: true, badges: true, game_show: true },
      },
    });
    prisma.user.update.mockImplementation(async ({ data }) => ({
      settings_json: data.settings_json,
    }));

    const result = await service.updateStudentSettings('student-1', {
      sound: false,
      notifications: { stories: false },
    });

    expect(result.data.read_to_me).toBe(true);
    expect(result.data.sound).toBe(false);
    expect(result.data.notifications).toEqual({
      stories: false,
      badges: true,
      game_show: true,
    });
  });
});
