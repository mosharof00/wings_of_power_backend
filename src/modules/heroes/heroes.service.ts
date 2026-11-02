import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Hero, Role, UserStatus } from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class HeroesService {
  constructor(private readonly prisma: PrismaService) {}

  async getCompletedStoriesCount(userId: string): Promise<number> {
    if (!this.prisma.readingProgress?.count) {
      return 0;
    }
    return this.prisma.readingProgress.count({
      where: {
        user_id: userId,
        completed_at: { not: null },
        story: { deleted_at: null },
      },
    });
  }

  async isHeroUnlocked(
    userId: string,
    hero: Hero,
    completedStoriesCount?: number,
  ): Promise<boolean> {
    if (hero.unlock_stories_required === 0) {
      return true;
    }

    const unlock = await this.prisma.studentHeroUnlock.findFirst({
      where: { user_id: userId, hero_id: hero.id },
    });
    if (unlock) {
      return true;
    }

    const count =
      completedStoriesCount !== undefined
        ? completedStoriesCount
        : await this.getCompletedStoriesCount(userId);

    return count >= hero.unlock_stories_required;
  }

  async findAll(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
    });
    if (!user) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    if (user.role !== Role.STUDENT) {
      throw new HttpException('Student only', HttpStatus.FORBIDDEN);
    }

    const [heroes, unlocks, completedStoriesCount] = await Promise.all([
      this.prisma.hero.findMany({
        orderBy: { sort_order: 'asc' },
      }),
      this.prisma.studentHeroUnlock.findMany({
        where: { user_id: userId },
      }),
      this.getCompletedStoriesCount(userId),
    ]);

    const unlockedHeroIds = new Set(unlocks.map((u) => u.hero_id));

    const data = heroes.map((hero) => {
      const isUnlocked =
        unlockedHeroIds.has(hero.id) ||
        hero.unlock_stories_required === 0 ||
        completedStoriesCount >= hero.unlock_stories_required;
      const isSelected = user.selected_hero_id === hero.id;

      return this.formatHero(hero, isUnlocked, isSelected);
    });

    return {
      success: true,
      data,
    };
  }

  async select(userId: string, heroId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
    });
    if (!user) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    if (user.role !== Role.STUDENT) {
      throw new HttpException('Student only', HttpStatus.FORBIDDEN);
    }
    if (user.status === UserStatus.INACTIVE) {
      throw new HttpException('Inactive account', HttpStatus.FORBIDDEN);
    }

    const hero = await this.prisma.hero.findFirst({
      where: { id: heroId },
    });
    if (!hero) {
      throw new HttpException('Hero not found', HttpStatus.NOT_FOUND);
    }

    const unlock = await this.prisma.studentHeroUnlock.findFirst({
      where: { user_id: user.id, hero_id: hero.id },
    });

    const completedStoriesCount = await this.getCompletedStoriesCount(user.id);
    const isUnlocked =
      !!unlock ||
      hero.unlock_stories_required === 0 ||
      completedStoriesCount >= hero.unlock_stories_required;

    if (!isUnlocked) {
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

    const updatedUser = await this.prisma.user.findFirst({
      where: { id: user.id },
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

    const targetUser = updatedUser ?? user;
    const membership = (targetUser as any).memberships?.[0] ?? null;
    const selectedHero = (targetUser as any).selected_hero ?? hero;

    return {
      success: true,
      data: {
        id: targetUser.id,
        email: targetUser.email,
        role: targetUser.role,
        status: targetUser.status,
        name: targetUser.real_name,
        username: targetUser.username,
        nickname: targetUser.nickname,
        schoolId: targetUser.school_id,
        selected_hero_id: selectedHero.id,
        selectedHeroId: selectedHero.id,
        school: (targetUser as any).school
          ? {
              id: (targetUser as any).school.id,
              name: (targetUser as any).school.name,
            }
          : null,
        class: membership
          ? {
              membershipId: membership.id,
              classId: membership.class_id,
              className: membership.class.name,
              status: membership.status,
            }
          : null,
        hero: this.formatSelectedHero(selectedHero),
      },
    };
  }

  private formatHero(hero: Hero, isUnlocked: boolean, isSelected: boolean) {
    return {
      id: hero.id,
      code: hero.code,
      display_name: hero.display_name,
      displayName: hero.display_name,
      role_title: hero.role_title,
      roleTitle: hero.role_title,
      bullied_for: hero.bullied_for,
      bulliedFor: hero.bullied_for,
      power_code: hero.power_code,
      powerCode: hero.power_code,
      power_label: hero.power_label,
      powerLabel: hero.power_label,
      power_description: hero.power_description,
      powerDescription: hero.power_description,
      quote: hero.quote,
      art_url: hero.art_url,
      artUrl: hero.art_url,
      sort_order: hero.sort_order,
      sortOrder: hero.sort_order,
      unlock_stories_required: hero.unlock_stories_required,
      unlockStoriesRequired: hero.unlock_stories_required,
      unlocked: isUnlocked,
      is_unlocked: isUnlocked,
      isUnlocked: isUnlocked,
      locked: !isUnlocked,
      is_locked: !isUnlocked,
      isLocked: !isUnlocked,
      is_selected: isSelected,
      isSelected: isSelected,
    };
  }

  private formatSelectedHero(hero: Hero) {
    return {
      id: hero.id,
      code: hero.code,
      display_name: hero.display_name,
      displayName: hero.display_name,
      role_title: hero.role_title,
      roleTitle: hero.role_title,
      bullied_for: hero.bullied_for,
      bulliedFor: hero.bullied_for,
      power_code: hero.power_code,
      powerCode: hero.power_code,
      power_label: hero.power_label,
      powerLabel: hero.power_label,
      power_description: hero.power_description,
      powerDescription: hero.power_description,
      quote: hero.quote,
      art_url: hero.art_url,
      artUrl: hero.art_url,
      sort_order: hero.sort_order,
      sortOrder: hero.sort_order,
      unlock_stories_required: hero.unlock_stories_required,
      unlockStoriesRequired: hero.unlock_stories_required,
    };
  }
}
