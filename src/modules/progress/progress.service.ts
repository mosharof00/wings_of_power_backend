import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  JoinRequestStatus,
  PublishStatus,
  ReadingProgress,
  Role,
} from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PutProgressDto } from './dto/progress.dto';

let activePrismaService: PrismaService | null = null;

export interface EligibilityResult {
  eligible: boolean;
  progress: {
    storiesCompleted: number;
    chaptersCompleted: number;
    quizMean: number;
  };
  rules: {
    requiredStories: number;
    requiredChapters: number;
    minQuizPercent: number;
  };
}

export async function eligibilityFor(
  prismaOrUserId: PrismaService | string,
  userIdOrPrisma?: string | PrismaService,
): Promise<EligibilityResult> {
  let prisma: PrismaService;
  let userId: string;

  if (typeof prismaOrUserId === 'string') {
    userId = prismaOrUserId;
    if (userIdOrPrisma && typeof userIdOrPrisma !== 'string') {
      prisma = userIdOrPrisma;
    } else if (activePrismaService) {
      prisma = activePrismaService;
    } else {
      throw new Error('PrismaService is required for eligibilityFor');
    }
  } else {
    prisma = prismaOrUserId;
    userId = userIdOrPrisma as string;
  }

  const [completedStories, completedChapters, scoredChapters, user] =
    await Promise.all([
      prisma.readingProgress.count({
        where: {
          user_id: userId,
          completed_at: { not: null },
          story: { deleted_at: null },
        },
      }),
      prisma.chapterProgress.count({
        where: {
          user_id: userId,
          completed_at: { not: null },
          chapter: { deleted_at: null },
        },
      }),
      prisma.chapterProgress.findMany({
        where: {
          user_id: userId,
          quiz_best_percent: { not: null },
          chapter: { deleted_at: null },
        },
        select: { quiz_best_percent: true },
      }),
      prisma.user.findFirst({
        where: { id: userId },
        select: { school_id: true },
      }),
    ]);

  const config = user?.school_id
    ? await prisma.gameEligibilityConfig.findFirst({
        where: { school_id: user.school_id },
      })
    : null;

  const requiredStories = config?.required_stories ?? 2;
  const requiredChapters = config?.required_chapters ?? 6;
  const minQuizPercent = config?.min_quiz_percent ?? 70;

  const hasQuizScores = scoredChapters.length > 0;
  const sumScores = scoredChapters.reduce(
    (acc, row) => acc + (row.quiz_best_percent ?? 0),
    0,
  );
  const quizMean = hasQuizScores
    ? Math.round((sumScores / scoredChapters.length) * 100) / 100
    : 0;

  const storiesOrChaptersMet =
    completedStories >= requiredStories ||
    completedChapters >= requiredChapters;
  const quizConditionMet = hasQuizScores && quizMean >= minQuizPercent;
  const eligible = storiesOrChaptersMet && quizConditionMet;

  return {
    eligible,
    progress: {
      storiesCompleted: completedStories,
      chaptersCompleted: completedChapters,
      quizMean,
    },
    rules: {
      requiredStories,
      requiredChapters,
      minQuizPercent,
    },
  };
}

@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {
    activePrismaService = prisma;
  }

  async eligibilityFor(userId: string): Promise<EligibilityResult> {
    return eligibilityFor(this.prisma, userId);
  }

  async putStoryProgress(userId: string, storyId: string, dto: PutProgressDto) {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user || user.role !== Role.STUDENT) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (!user.school_id) {
      throw new HttpException(
        'School is not set up',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const story = await this.prisma.story.findFirst({
      where: { id: storyId, deleted_at: null },
    });
    if (
      !story ||
      story.status !== PublishStatus.PUBLISHED ||
      story.school_id !== user.school_id
    ) {
      throw new HttpException('Story not found', HttpStatus.NOT_FOUND);
    }

    const chapterId = dto.chapterId ?? dto.chapter_id;
    const pageNumber = dto.pageNumber ?? dto.page_number;
    const mode = dto.lastMode ?? dto.last_mode ?? dto.mode;

    if (chapterId) {
      const chapter = await this.prisma.chapter.findFirst({
        where: { id: chapterId, story_id: story.id, deleted_at: null },
      });
      if (!chapter) {
        throw new HttpException('Chapter not found', HttpStatus.NOT_FOUND);
      }
    }

    const clampedPercent = Math.max(
      0,
      Math.min(100, Math.round(Number(dto.percent))),
    );

    const progress = await this.prisma.readingProgress.upsert({
      where: {
        user_id_story_id: {
          user_id: userId,
          story_id: storyId,
        },
      },
      create: {
        user_id: userId,
        story_id: storyId,
        chapter_id: chapterId ?? null,
        page_number: pageNumber ?? null,
        percent: clampedPercent,
        last_mode: mode ?? null,
      },
      update: {
        ...(chapterId !== undefined ? { chapter_id: chapterId } : {}),
        ...(pageNumber !== undefined ? { page_number: pageNumber } : {}),
        percent: clampedPercent,
        ...(mode !== undefined ? { last_mode: mode } : {}),
      },
    });

    return {
      success: true,
      message: 'Progress updated',
      data: this.toReadingProgress(progress),
    };
  }

  async completeChapter(userId: string, storyId: string, chapterId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user || user.role !== Role.STUDENT) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (!user.school_id) {
      throw new HttpException(
        'School is not set up',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const story = await this.prisma.story.findFirst({
      where: { id: storyId, deleted_at: null },
    });
    if (
      !story ||
      story.status !== PublishStatus.PUBLISHED ||
      story.school_id !== user.school_id
    ) {
      throw new HttpException('Story not found', HttpStatus.NOT_FOUND);
    }

    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, story_id: story.id, deleted_at: null },
    });
    if (!chapter) {
      throw new HttpException('Chapter not found', HttpStatus.NOT_FOUND);
    }

    const now = new Date();
    const chapterProgress = await this.prisma.chapterProgress.upsert({
      where: {
        user_id_chapter_id: {
          user_id: userId,
          chapter_id: chapterId,
        },
      },
      create: {
        user_id: userId,
        chapter_id: chapterId,
        percent: 100,
        completed_at: now,
      },
      update: {
        percent: 100,
        completed_at: now,
      },
    });

    const nonDeletedChapters = await this.prisma.chapter.findMany({
      where: { story_id: story.id, deleted_at: null },
      select: { id: true },
    });
    const chapterIds = nonDeletedChapters.map((c) => c.id);
    const completedCount = await this.prisma.chapterProgress.count({
      where: {
        user_id: userId,
        chapter_id: { in: chapterIds },
        completed_at: { not: null },
      },
    });

    const allChaptersComplete =
      chapterIds.length > 0 && completedCount === chapterIds.length;

    let readingProgress = await this.prisma.readingProgress.findUnique({
      where: {
        user_id_story_id: {
          user_id: userId,
          story_id: story.id,
        },
      },
    });

    if (readingProgress) {
      readingProgress = await this.prisma.readingProgress.update({
        where: { id: readingProgress.id },
        data: {
          chapter_id: chapterId,
          ...(allChaptersComplete
            ? {
                percent: 100,
                completed_at: readingProgress.completed_at ?? now,
              }
            : {
                percent: Math.max(
                  readingProgress.percent,
                  Math.round((completedCount / (chapterIds.length || 1)) * 100),
                ),
              }),
        },
      });
    } else {
      readingProgress = await this.prisma.readingProgress.create({
        data: {
          user_id: userId,
          story_id: story.id,
          chapter_id: chapterId,
          percent: allChaptersComplete
            ? 100
            : Math.round((completedCount / (chapterIds.length || 1)) * 100),
          completed_at: allChaptersComplete ? now : null,
        },
      });
    }

    return {
      success: true,
      message: 'Chapter completed',
      data: {
        chapterId,
        percent: 100,
        completedAt: chapterProgress.completed_at,
        storyCompleted: allChaptersComplete,
        readingProgress: this.toReadingProgress(readingProgress),
      },
    };
  }

  async getReadingProgress(userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user || user.role !== Role.STUDENT) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const progressRows = await this.prisma.readingProgress.findMany({
      where: {
        user_id: userId,
        story: {
          deleted_at: null,
          status: PublishStatus.PUBLISHED,
          ...(user.school_id ? { school_id: user.school_id } : {}),
        },
      },
      include: {
        story: {
          include: {
            chapters: {
              where: { deleted_at: null },
              select: { id: true },
            },
          },
        },
      },
      orderBy: { updated_at: 'desc' },
    });

    const storiesStarted = progressRows.length;
    const storiesCompleted = progressRows.filter(
      (p) => p.completed_at !== null,
    ).length;

    const chaptersCompleted = await this.prisma.chapterProgress.count({
      where: {
        user_id: userId,
        completed_at: { not: null },
        chapter: {
          deleted_at: null,
          story: {
            deleted_at: null,
            status: PublishStatus.PUBLISHED,
            ...(user.school_id ? { school_id: user.school_id } : {}),
          },
        },
      },
    });

    const stories = await Promise.all(
      progressRows.map(async (row) => {
        const storyChapterIds = row.story.chapters.map((c) => c.id);
        const storyChaptersCompleted =
          storyChapterIds.length > 0
            ? await this.prisma.chapterProgress.count({
                where: {
                  user_id: userId,
                  chapter_id: { in: storyChapterIds },
                  completed_at: { not: null },
                },
              })
            : 0;

        return {
          id: row.id,
          storyId: row.story.id,
          title: row.story.title,
          synopsis: row.story.synopsis,
          coverUrl: row.story.cover_url,
          category: row.story.category,
          ageGroup: row.story.age_group,
          chapterCount: row.story.chapter_count,
          chaptersCompleted: storyChaptersCompleted,
          percent: row.percent,
          completedAt: row.completed_at,
          lastMode: row.last_mode,
          currentChapterId: row.chapter_id,
          currentPageNumber: row.page_number,
          updatedAt: row.updated_at,
        };
      }),
    );

    return {
      success: true,
      data: {
        summary: {
          storiesStarted,
          storiesCompleted,
          chaptersCompleted,
        },
        stories,
        items: stories,
      },
    };
  }

  async getStudentHome(userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user || user.role !== Role.STUDENT) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const greetingName = user.nickname || user.username || 'Student';

    const pointsSum = await this.prisma.pointsLedger.aggregate({
      where: { user_id: userId },
      _sum: { amount: true },
    });
    const pointsTotal = pointsSum._sum.amount ?? 0;

    const continueProgress = await this.prisma.readingProgress.findFirst({
      where: {
        user_id: userId,
        completed_at: null,
        story: {
          deleted_at: null,
          status: PublishStatus.PUBLISHED,
          ...(user.school_id ? { school_id: user.school_id } : {}),
        },
      },
      include: {
        story: true,
      },
      orderBy: { updated_at: 'desc' },
    });

    const continueStory = continueProgress
      ? {
          id: continueProgress.id,
          storyId: continueProgress.story.id,
          title: continueProgress.story.title,
          synopsis: continueProgress.story.synopsis,
          coverUrl: continueProgress.story.cover_url,
          category: continueProgress.story.category,
          ageGroup: continueProgress.story.age_group,
          chapterCount: continueProgress.story.chapter_count,
          percent: continueProgress.percent,
          currentChapterId: continueProgress.chapter_id,
          currentPageNumber: continueProgress.page_number,
          lastMode: continueProgress.last_mode,
          updatedAt: continueProgress.updated_at,
        }
      : null;

    const membership = await this.prisma.classMembership.findFirst({
      where: {
        user_id: userId,
        status: JoinRequestStatus.APPROVED,
      },
      include: { class: true },
      orderBy: { updated_at: 'desc' },
    });
    const studentAgeGroup = membership?.class?.age_group;

    let popularRows = [];
    if (studentAgeGroup && user.school_id) {
      popularRows = await this.prisma.story.findMany({
        where: {
          school_id: user.school_id,
          status: PublishStatus.PUBLISHED,
          deleted_at: null,
          age_group: studentAgeGroup,
        },
        orderBy: { created_at: 'desc' },
        take: 10,
      });
    }

    if (popularRows.length < 10 && user.school_id) {
      const existingIds = popularRows.map((s) => s.id);
      const remaining = await this.prisma.story.findMany({
        where: {
          school_id: user.school_id,
          status: PublishStatus.PUBLISHED,
          deleted_at: null,
          id: { notIn: existingIds },
        },
        orderBy: { created_at: 'desc' },
        take: 10 - popularRows.length,
      });
      popularRows = [...popularRows, ...remaining];
    }

    const popularStories = popularRows.map((s) => ({
      id: s.id,
      title: s.title,
      synopsis: s.synopsis,
      coverUrl: s.cover_url,
      category: s.category,
      ageGroup: s.age_group,
      estimatedMinutes: s.estimated_minutes,
      chapterCount: s.chapter_count,
    }));

    const eligibility = await this.eligibilityFor(userId);

    return {
      success: true,
      data: {
        greetingName,
        pointsTotal,
        points: pointsTotal,
        continueStory,
        popularStories,
        eligible: eligibility.eligible,
      },
    };
  }

  private toReadingProgress(row: ReadingProgress) {
    return {
      id: row.id,
      storyId: row.story_id,
      chapterId: row.chapter_id,
      pageNumber: row.page_number,
      percent: row.percent,
      completedAt: row.completed_at,
      lastMode: row.last_mode,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
