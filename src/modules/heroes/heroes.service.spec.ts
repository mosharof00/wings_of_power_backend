import { HttpException } from '@nestjs/common';
import { PowerCode, Role, UserStatus } from 'prisma/generated/client';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HeroesService } from './heroes.service';

function expectStatus(error: unknown, status: number) {
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(status);
}

describe('HeroesService', () => {
  let prisma: any;
  let service: HeroesService;

  const mockStarterHero = {
    id: 'hero-faith',
    code: 'FAITH',
    display_name: 'Faith',
    role_title: 'Musician',
    bullied_for: 'Singing voice',
    power_code: PowerCode.MELODY,
    power_label: 'Melody Shot',
    power_description: 'Adds +10s to buzz clock',
    quote: 'Music heals',
    art_url: 'https://cdn.example.com/faith.png',
    sort_order: 1,
    unlock_stories_required: 0,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockTwoStoryHero = {
    id: 'hero-harold',
    code: 'HAROLD',
    display_name: 'Harold',
    role_title: 'Scientist',
    bullied_for: 'Glasses',
    power_code: PowerCode.LAB,
    power_label: 'Lab Focus',
    power_description: 'Reveals one wrong option',
    quote: 'Science is discovery',
    art_url: 'https://cdn.example.com/harold.png',
    sort_order: 2,
    unlock_stories_required: 2,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockStudent = {
    id: 'student-1',
    role: Role.STUDENT,
    status: UserStatus.ACTIVE,
    email: 'student1@demo.school',
    username: 'student1',
    nickname: 'HeroKid',
    real_name: 'Hero Kid',
    selected_hero_id: 'hero-faith',
    school_id: 'school-1',
    school: { id: 'school-1', name: 'Demo School' },
    memberships: [
      {
        id: 'membership-1',
        class_id: 'class-1',
        status: 'ACTIVE',
        class: { id: 'class-1', name: 'Grade 4' },
      },
    ],
  };

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      hero: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      studentHeroUnlock: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
      readingProgress: {
        count: jest.fn(),
      },
    };

    service = new HeroesService(prisma as unknown as PrismaService);
  });

  describe('unlock logic and findAll', () => {
    it('hero with unlock_stories_required 2 is locked at 1 completed story and unlocked at 2', async () => {
      prisma.user.findFirst.mockResolvedValue(mockStudent);
      prisma.hero.findMany.mockResolvedValue([
        mockStarterHero,
        mockTwoStoryHero,
      ]);
      prisma.studentHeroUnlock.findMany.mockResolvedValue([]);

      // 1 completed story -> hero-2 is locked
      prisma.readingProgress.count.mockResolvedValue(1);

      let result = await service.findAll(mockStudent.id);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);

      const starterAt1 = result.data.find(
        (h: any) => h.id === mockStarterHero.id,
      );
      const twoStoryAt1 = result.data.find(
        (h: any) => h.id === mockTwoStoryHero.id,
      );

      expect(starterAt1.unlocked).toBe(true);
      expect(starterAt1.locked).toBe(false);
      expect(twoStoryAt1.unlocked).toBe(false);
      expect(twoStoryAt1.locked).toBe(true);

      // Also verify isHeroUnlocked direct check
      prisma.studentHeroUnlock.findFirst.mockResolvedValue(null);
      const isUnlockedAt1 = await service.isHeroUnlocked(
        mockStudent.id,
        mockTwoStoryHero as any,
        1,
      );
      expect(isUnlockedAt1).toBe(false);

      // 2 completed stories -> hero-2 is unlocked
      prisma.readingProgress.count.mockResolvedValue(2);

      result = await service.findAll(mockStudent.id);
      const twoStoryAt2 = result.data.find(
        (h: any) => h.id === mockTwoStoryHero.id,
      );

      expect(twoStoryAt2.unlocked).toBe(true);
      expect(twoStoryAt2.locked).toBe(false);

      const isUnlockedAt2 = await service.isHeroUnlocked(
        mockStudent.id,
        mockTwoStoryHero as any,
        2,
      );
      expect(isUnlockedAt2).toBe(true);
    });

    it('starter hero with unlock_stories_required 0 is unlocked at 0 completed stories', async () => {
      prisma.user.findFirst.mockResolvedValue(mockStudent);
      prisma.hero.findMany.mockResolvedValue([mockStarterHero]);
      prisma.studentHeroUnlock.findMany.mockResolvedValue([]);
      prisma.readingProgress.count.mockResolvedValue(0);

      const result = await service.findAll(mockStudent.id);
      expect(result.data[0].unlocked).toBe(true);
      expect(result.data[0].locked).toBe(false);

      const isUnlocked = await service.isHeroUnlocked(
        mockStudent.id,
        mockStarterHero as any,
        0,
      );
      expect(isUnlocked).toBe(true);
    });
  });

  describe('select', () => {
    it('select on a locked hero -> 403', async () => {
      prisma.user.findFirst.mockResolvedValue(mockStudent);
      prisma.hero.findFirst.mockResolvedValue(mockTwoStoryHero);
      prisma.studentHeroUnlock.findFirst.mockResolvedValue(null);
      prisma.readingProgress.count.mockResolvedValue(1);

      try {
        await service.select(mockStudent.id, mockTwoStoryHero.id);
        throw new Error('expected forbidden');
      } catch (error) {
        expectStatus(error, 403);
      }

      expect(prisma.studentHeroUnlock.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('select sets selected_hero_id and is idempotent', async () => {
      // First call: unlocked via 2 stories completed, no unlock record yet
      prisma.user.findFirst
        .mockResolvedValueOnce(mockStudent) // initial lookup
        .mockResolvedValueOnce({
          ...mockStudent,
          selected_hero_id: mockTwoStoryHero.id,
          selected_hero: mockTwoStoryHero,
        }); // lookup after update
      prisma.hero.findFirst.mockResolvedValue(mockTwoStoryHero);
      prisma.studentHeroUnlock.findFirst.mockResolvedValue(null);
      prisma.readingProgress.count.mockResolvedValue(2);
      prisma.studentHeroUnlock.create.mockResolvedValue({
        user_id: mockStudent.id,
        hero_id: mockTwoStoryHero.id,
      });
      prisma.user.update.mockResolvedValue({
        ...mockStudent,
        selected_hero_id: mockTwoStoryHero.id,
      });

      const firstResult = await service.select(
        mockStudent.id,
        mockTwoStoryHero.id,
      );

      expect(firstResult.success).toBe(true);
      expect(firstResult.data.selected_hero_id).toBe(mockTwoStoryHero.id);
      expect(prisma.studentHeroUnlock.create).toHaveBeenCalledWith({
        data: {
          user_id: mockStudent.id,
          hero_id: mockTwoStoryHero.id,
        },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: mockStudent.id },
        data: { selected_hero_id: mockTwoStoryHero.id },
      });

      // Second call: unlock record already exists (idempotent)
      jest.clearAllMocks();
      prisma.user.findFirst
        .mockResolvedValueOnce({
          ...mockStudent,
          selected_hero_id: mockTwoStoryHero.id,
        })
        .mockResolvedValueOnce({
          ...mockStudent,
          selected_hero_id: mockTwoStoryHero.id,
          selected_hero: mockTwoStoryHero,
        });
      prisma.hero.findFirst.mockResolvedValue(mockTwoStoryHero);
      prisma.studentHeroUnlock.findFirst.mockResolvedValue({
        user_id: mockStudent.id,
        hero_id: mockTwoStoryHero.id,
      });
      prisma.readingProgress.count.mockResolvedValue(2);

      const secondResult = await service.select(
        mockStudent.id,
        mockTwoStoryHero.id,
      );

      expect(secondResult.success).toBe(true);
      expect(secondResult.data.selected_hero_id).toBe(mockTwoStoryHero.id);
      // StudentHeroUnlock.create should not be called again
      expect(prisma.studentHeroUnlock.create).not.toHaveBeenCalled();
    });

    it('rejects select if hero not found (404)', async () => {
      prisma.user.findFirst.mockResolvedValue(mockStudent);
      prisma.hero.findFirst.mockResolvedValue(null);

      try {
        await service.select(mockStudent.id, 'non-existent');
        throw new Error('expected not found');
      } catch (error) {
        expectStatus(error, 404);
      }
    });

    it('rejects select if user not found (401)', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      try {
        await service.select('unknown-user', mockStarterHero.id);
        throw new Error('expected unauthorized');
      } catch (error) {
        expectStatus(error, 401);
      }
    });

    it('rejects select if user role is not STUDENT (403)', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'teacher-1',
        role: Role.TEACHER,
      });

      try {
        await service.select('teacher-1', mockStarterHero.id);
        throw new Error('expected forbidden');
      } catch (error) {
        expectStatus(error, 403);
      }
    });

    it('rejects select if student user is INACTIVE (403)', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'student-inactive',
        role: Role.STUDENT,
        status: UserStatus.INACTIVE,
      });

      try {
        await service.select('student-inactive', mockStarterHero.id);
        throw new Error('expected forbidden');
      } catch (error) {
        expectStatus(error, 403);
      }
    });
  });

  describe('response shape and data isolation', () => {
    it('response includes power_code and power_label and does not include other students', async () => {
      prisma.user.findFirst.mockResolvedValue(mockStudent);
      prisma.hero.findMany.mockResolvedValue([mockStarterHero]);
      prisma.studentHeroUnlock.findMany.mockResolvedValue([]);
      prisma.readingProgress.count.mockResolvedValue(0);

      // Test findAll response
      const listResult = await service.findAll(mockStudent.id);
      expect(listResult.success).toBe(true);
      const heroItem = listResult.data[0];
      expect(heroItem.power_code).toBe(PowerCode.MELODY);
      expect(heroItem.power_label).toBe('Melody Shot');
      expect(heroItem.powerCode).toBe(PowerCode.MELODY);
      expect(heroItem.powerLabel).toBe('Melody Shot');

      // Check no other student info is present
      const jsonString = JSON.stringify(listResult);
      expect(jsonString).not.toContain('other-student');
      expect(heroItem).not.toHaveProperty('user_id');
      expect(heroItem).not.toHaveProperty('students');

      // Test select response
      prisma.user.findFirst
        .mockResolvedValueOnce(mockStudent)
        .mockResolvedValueOnce({
          ...mockStudent,
          selected_hero_id: mockStarterHero.id,
          selected_hero: mockStarterHero,
        });
      prisma.hero.findFirst.mockResolvedValue(mockStarterHero);
      prisma.studentHeroUnlock.findFirst.mockResolvedValue(null);
      prisma.studentHeroUnlock.create.mockResolvedValue({});
      prisma.user.update.mockResolvedValue({});

      const selectResult = await service.select(
        mockStudent.id,
        mockStarterHero.id,
      );
      expect(selectResult.success).toBe(true);
      expect(selectResult.data.hero.power_code).toBe(PowerCode.MELODY);
      expect(selectResult.data.hero.power_label).toBe('Melody Shot');
      expect(selectResult.data.hero.powerCode).toBe(PowerCode.MELODY);
      expect(selectResult.data.hero.powerLabel).toBe('Melody Shot');
      expect(selectResult.data.id).toBe(mockStudent.id);

      const selectJsonString = JSON.stringify(selectResult);
      expect(selectJsonString).not.toContain('other-student');
    });
  });

  describe('auth select-hero delegation', () => {
    it('auth select-hero uses the same service (delegates to HeroesService)', async () => {
      const mockHeroesService = {
        select: jest.fn().mockResolvedValue({
          success: true,
          data: {
            id: mockStudent.id,
            selected_hero_id: mockStarterHero.id,
          },
        }),
      };

      const mail = { sendOtpCodeToEmail: jest.fn() };
      const jwt = { signAsync: jest.fn().mockResolvedValue('token') };

      const authService = new AuthService(
        prisma as unknown as PrismaService,
        mail as any,
        jwt as any,
        mockHeroesService as unknown as HeroesService,
      );

      const result = await authService.selectHero(mockStudent.id, {
        heroId: mockStarterHero.id,
      });

      expect(mockHeroesService.select).toHaveBeenCalledWith(
        mockStudent.id,
        mockStarterHero.id,
      );
      expect(result.success).toBe(true);
      expect(result.data.selected_hero_id).toBe(mockStarterHero.id);
    });
  });
});
