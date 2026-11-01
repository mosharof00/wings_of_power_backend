import { HttpException, HttpStatus } from '@nestjs/common';
import {
  AgeGroup,
  PublishStatus,
  ReadingMode,
  Role,
  StoryCategory,
} from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { eligibilityFor, ProgressService } from './progress.service';

describe('ProgressService', () => {
  const prisma = {
    user: { findFirst: jest.fn() },
    story: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    chapter: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    chapterProgress: {
      upsert: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    readingProgress: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    pointsLedger: {
      aggregate: jest.fn(),
    },
    classMembership: {
      findFirst: jest.fn(),
    },
    gameEligibilityConfig: {
      findFirst: jest.fn(),
    },
  };

  const service = new ProgressService(prisma as unknown as PrismaService);

  const studentUser = {
    id: 'student-1',
    role: Role.STUDENT,
    school_id: 'school-1',
    nickname: 'HeroKid',
    username: 'herokid1',
  };

  const publishedStory = {
    id: 'story-1',
    school_id: 'school-1',
    title: 'Kind Wings',
    synopsis: 'A tale of courage',
    cover_url: 'https://cdn.example.com/cover.jpg',
    category: StoryCategory.KINDNESS,
    age_group: AgeGroup.AGE_6_9,
    status: PublishStatus.PUBLISHED,
    estimated_minutes: 10,
    chapter_count: 2,
    deleted_at: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findFirst.mockReset();
    prisma.story.findFirst.mockReset();
    prisma.story.findMany.mockReset();
    prisma.chapter.findFirst.mockReset();
    prisma.chapter.findMany.mockReset();
    prisma.chapterProgress.upsert.mockReset();
    prisma.chapterProgress.count.mockReset();
    prisma.chapterProgress.findMany.mockReset();
    prisma.readingProgress.upsert.mockReset();
    prisma.readingProgress.findUnique.mockReset();
    prisma.readingProgress.findFirst.mockReset();
    prisma.readingProgress.findMany.mockReset();
    prisma.readingProgress.count.mockReset();
    prisma.readingProgress.create.mockReset();
    prisma.readingProgress.update.mockReset();
    prisma.pointsLedger.aggregate.mockReset();
    prisma.classMembership.findFirst.mockReset();
    prisma.gameEligibilityConfig.findFirst.mockReset();

    prisma.user.findFirst.mockResolvedValue(studentUser);
    prisma.story.findFirst.mockResolvedValue(publishedStory);
  });

  describe('putStoryProgress', () => {
    it('progress upsert does not create a second row', async () => {
      prisma.chapter.findFirst.mockResolvedValue({
        id: 'chap-1',
        story_id: 'story-1',
        deleted_at: null,
      });

      const upserted = {
        id: 'rp-1',
        user_id: 'student-1',
        story_id: 'story-1',
        chapter_id: 'chap-1',
        page_number: 2,
        percent: 50,
        completed_at: null,
        last_mode: ReadingMode.READ,
        created_at: new Date(),
        updated_at: new Date(),
      };
      prisma.readingProgress.upsert.mockResolvedValue(upserted);

      const res = await service.putStoryProgress('student-1', 'story-1', {
        chapterId: 'chap-1',
        pageNumber: 2,
        percent: 50,
        lastMode: ReadingMode.READ,
      });

      expect(res.success).toBe(true);
      expect(prisma.readingProgress.upsert).toHaveBeenCalledWith({
        where: {
          user_id_story_id: {
            user_id: 'student-1',
            story_id: 'story-1',
          },
        },
        create: {
          user_id: 'student-1',
          story_id: 'story-1',
          chapter_id: 'chap-1',
          page_number: 2,
          percent: 50,
          last_mode: ReadingMode.READ,
        },
        update: {
          chapter_id: 'chap-1',
          page_number: 2,
          percent: 50,
          last_mode: ReadingMode.READ,
        },
      });
    });

    it('percent 140 is stored as 100', async () => {
      prisma.readingProgress.upsert.mockResolvedValue({
        id: 'rp-1',
        user_id: 'student-1',
        story_id: 'story-1',
        chapter_id: null,
        page_number: null,
        percent: 100,
        completed_at: null,
        last_mode: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await service.putStoryProgress('student-1', 'story-1', {
        percent: 140,
      });

      expect(prisma.readingProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ percent: 100 }),
          update: expect.objectContaining({ percent: 100 }),
        }),
      );
    });

    it('clamps negative percent to 0', async () => {
      prisma.readingProgress.upsert.mockResolvedValue({
        id: 'rp-1',
        user_id: 'student-1',
        story_id: 'story-1',
        chapter_id: null,
        page_number: null,
        percent: 0,
        completed_at: null,
        last_mode: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await service.putStoryProgress('student-1', 'story-1', {
        percent: -25,
      });

      expect(prisma.readingProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ percent: 0 }),
          update: expect.objectContaining({ percent: 0 }),
        }),
      );
    });

    it('draft story progress -> 404', async () => {
      prisma.story.findFirst.mockResolvedValue({
        ...publishedStory,
        status: PublishStatus.DRAFT,
      });

      await expect(
        service.putStoryProgress('student-1', 'story-1', { percent: 10 }),
      ).rejects.toThrow(
        new HttpException('Story not found', HttpStatus.NOT_FOUND),
      );
    });

    it('deleted story progress -> 404', async () => {
      prisma.story.findFirst.mockResolvedValue(null);

      await expect(
        service.putStoryProgress('student-1', 'story-1', { percent: 10 }),
      ).rejects.toThrow(
        new HttpException('Story not found', HttpStatus.NOT_FOUND),
      );
    });
  });

  describe('completeChapter', () => {
    it('completing a chapter that is not the last does not set story completed_at', async () => {
      prisma.chapter.findFirst.mockResolvedValue({
        id: 'chap-1',
        story_id: 'story-1',
        deleted_at: null,
      });
      prisma.chapterProgress.upsert.mockResolvedValue({
        user_id: 'student-1',
        chapter_id: 'chap-1',
        percent: 100,
        completed_at: new Date(),
      });
      prisma.chapter.findMany.mockResolvedValue([
        { id: 'chap-1' },
        { id: 'chap-2' },
      ]);
      // Only 1 of 2 chapters completed
      prisma.chapterProgress.count.mockResolvedValue(1);

      prisma.readingProgress.findUnique.mockResolvedValue(null);
      prisma.readingProgress.create.mockResolvedValue({
        id: 'rp-1',
        user_id: 'student-1',
        story_id: 'story-1',
        chapter_id: 'chap-1',
        percent: 50,
        completed_at: null,
        last_mode: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await service.completeChapter(
        'student-1',
        'story-1',
        'chap-1',
      );

      expect(res.success).toBe(true);
      expect(res.data.storyCompleted).toBe(false);
      expect(prisma.readingProgress.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          completed_at: null,
        }),
      });
    });

    it('completing the last chapter sets story completed_at', async () => {
      prisma.chapter.findFirst.mockResolvedValue({
        id: 'chap-2',
        story_id: 'story-1',
        deleted_at: null,
      });
      prisma.chapterProgress.upsert.mockResolvedValue({
        user_id: 'student-1',
        chapter_id: 'chap-2',
        percent: 100,
        completed_at: new Date(),
      });
      prisma.chapter.findMany.mockResolvedValue([
        { id: 'chap-1' },
        { id: 'chap-2' },
      ]);
      // All 2 chapters completed
      prisma.chapterProgress.count.mockResolvedValue(2);

      const existingReadingProgress = {
        id: 'rp-1',
        user_id: 'student-1',
        story_id: 'story-1',
        chapter_id: 'chap-1',
        percent: 50,
        completed_at: null,
        last_mode: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      prisma.readingProgress.findUnique.mockResolvedValue(
        existingReadingProgress,
      );
      prisma.readingProgress.update.mockResolvedValue({
        ...existingReadingProgress,
        chapter_id: 'chap-2',
        percent: 100,
        completed_at: new Date(),
      });

      const res = await service.completeChapter(
        'student-1',
        'story-1',
        'chap-2',
      );

      expect(res.success).toBe(true);
      expect(res.data.storyCompleted).toBe(true);
      expect(prisma.readingProgress.update).toHaveBeenCalledWith({
        where: { id: 'rp-1' },
        data: expect.objectContaining({
          percent: 100,
          completed_at: expect.any(Date),
        }),
      });
    });

    it('chapter complete on draft story -> 404', async () => {
      prisma.story.findFirst.mockResolvedValue({
        ...publishedStory,
        status: PublishStatus.DRAFT,
      });

      await expect(
        service.completeChapter('student-1', 'story-1', 'chap-1'),
      ).rejects.toThrow(
        new HttpException('Story not found', HttpStatus.NOT_FOUND),
      );
    });
  });

  describe('getStudentHome', () => {
    it('home continue ignores a completed story', async () => {
      prisma.pointsLedger.aggregate.mockResolvedValue({
        _sum: { amount: 150 },
      });
      prisma.classMembership.findFirst.mockResolvedValue(null);
      prisma.story.findMany.mockResolvedValue([]);

      // Mock readingProgress.findFirst for continueStory returning null because only completed stories exist
      prisma.readingProgress.findFirst.mockResolvedValue(null);

      // Eligibility mocks
      prisma.readingProgress.count.mockResolvedValue(1);
      prisma.chapterProgress.count.mockResolvedValue(2);
      prisma.chapterProgress.findMany.mockResolvedValue([
        { quiz_best_percent: 80 },
      ]);
      prisma.gameEligibilityConfig.findFirst.mockResolvedValue(null);

      const res = await service.getStudentHome('student-1');

      expect(res.success).toBe(true);
      expect(prisma.readingProgress.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: 'student-1',
            completed_at: null,
          }),
        }),
      );
      expect(res.data.continueStory).toBeNull();
      expect(res.data.pointsTotal).toBe(150);
      expect(res.data.greetingName).toBe('HeroKid');
    });

    it('returns continueStory when an in-progress uncompleted story exists', async () => {
      prisma.pointsLedger.aggregate.mockResolvedValue({
        _sum: { amount: 50 },
      });
      prisma.classMembership.findFirst.mockResolvedValue(null);
      prisma.story.findMany.mockResolvedValue([]);

      prisma.readingProgress.findFirst.mockResolvedValue({
        id: 'rp-1',
        story_id: 'story-1',
        chapter_id: 'chap-1',
        page_number: 3,
        percent: 30,
        last_mode: ReadingMode.LISTEN,
        updated_at: new Date(),
        story: publishedStory,
      });

      prisma.readingProgress.count.mockResolvedValue(0);
      prisma.chapterProgress.count.mockResolvedValue(0);
      prisma.chapterProgress.findMany.mockResolvedValue([]);

      const res = await service.getStudentHome('student-1');

      expect(res.data.continueStory).toMatchObject({
        storyId: 'story-1',
        title: 'Kind Wings',
        percent: 30,
        currentChapterId: 'chap-1',
        currentPageNumber: 3,
        lastMode: ReadingMode.LISTEN,
      });
    });

    it('prioritizes stories matching student age group for popular stories', async () => {
      prisma.pointsLedger.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      prisma.readingProgress.findFirst.mockResolvedValue(null);
      prisma.readingProgress.count.mockResolvedValue(0);
      prisma.chapterProgress.count.mockResolvedValue(0);
      prisma.chapterProgress.findMany.mockResolvedValue([]);

      prisma.classMembership.findFirst.mockResolvedValue({
        class: { age_group: AgeGroup.AGE_6_9 },
      });

      const ageStory = {
        ...publishedStory,
        id: 'story-age-1',
        age_group: AgeGroup.AGE_6_9,
      };
      const otherStory = {
        ...publishedStory,
        id: 'story-other-1',
        age_group: AgeGroup.AGE_10_13,
      };

      // First query for age group returns ageStory
      prisma.story.findMany
        .mockResolvedValueOnce([ageStory])
        // Second query for fallback returns otherStory
        .mockResolvedValueOnce([otherStory]);

      const res = await service.getStudentHome('student-1');

      expect(res.data.popularStories).toHaveLength(2);
      expect(res.data.popularStories[0].id).toBe('story-age-1');
      expect(res.data.popularStories[1].id).toBe('story-other-1');
    });
  });

  describe('eligibilityFor', () => {
    it('eligibility is false at 0% quizzes and true at 2 completed stories with mean quiz 70 using default rules', async () => {
      // Case 1: 0% quizzes (e.g. scoredChapters has 0%)
      prisma.readingProgress.count.mockResolvedValue(2);
      prisma.chapterProgress.count.mockResolvedValue(6);
      prisma.chapterProgress.findMany.mockResolvedValue([
        { quiz_best_percent: 0 },
      ]);
      prisma.gameEligibilityConfig.findFirst.mockResolvedValue(null);

      const resZeroQuiz = await service.eligibilityFor('student-1');
      expect(resZeroQuiz.eligible).toBe(false);
      expect(resZeroQuiz.progress.quizMean).toBe(0);
      expect(resZeroQuiz.rules).toEqual({
        requiredStories: 2,
        requiredChapters: 6,
        minQuizPercent: 70,
      });

      // Case 2: 2 completed stories with mean quiz 70%
      prisma.readingProgress.count.mockResolvedValue(2);
      prisma.chapterProgress.count.mockResolvedValue(5);
      prisma.chapterProgress.findMany.mockResolvedValue([
        { quiz_best_percent: 70 },
      ]);

      const resEligible = await service.eligibilityFor('student-1');
      expect(resEligible.eligible).toBe(true);
      expect(resEligible.progress.storiesCompleted).toBe(2);
      expect(resEligible.progress.quizMean).toBe(70);

      // Also verify standalone exported eligibilityFor function
      const standaloneRes = await eligibilityFor(
        prisma as unknown as PrismaService,
        'student-1',
      );
      expect(standaloneRes.eligible).toBe(true);
    });

    it('eligibility is false when no quizzes taken (mean 0)', async () => {
      prisma.readingProgress.count.mockResolvedValue(5);
      prisma.chapterProgress.count.mockResolvedValue(10);
      prisma.chapterProgress.findMany.mockResolvedValue([]);
      prisma.gameEligibilityConfig.findFirst.mockResolvedValue(null);

      const res = await service.eligibilityFor('student-1');
      expect(res.eligible).toBe(false);
      expect(res.progress.quizMean).toBe(0);
    });

    it('eligibility is true at 6 completed chapters and mean quiz >= 70% even with < 2 stories', async () => {
      prisma.readingProgress.count.mockResolvedValue(1);
      prisma.chapterProgress.count.mockResolvedValue(6);
      prisma.chapterProgress.findMany.mockResolvedValue([
        { quiz_best_percent: 80 },
        { quiz_best_percent: 60 },
      ]);
      prisma.gameEligibilityConfig.findFirst.mockResolvedValue(null);

      const res = await service.eligibilityFor('student-1');
      expect(res.eligible).toBe(true);
      expect(res.progress.storiesCompleted).toBe(1);
      expect(res.progress.chaptersCompleted).toBe(6);
      expect(res.progress.quizMean).toBe(70);
    });

    it('respects custom GameEligibilityConfig if configured', async () => {
      prisma.readingProgress.count.mockResolvedValue(2);
      prisma.chapterProgress.count.mockResolvedValue(6);
      prisma.chapterProgress.findMany.mockResolvedValue([
        { quiz_best_percent: 75 },
      ]);
      prisma.gameEligibilityConfig.findFirst.mockResolvedValue({
        required_stories: 3,
        required_chapters: 10,
        min_quiz_percent: 80,
      });

      const res = await service.eligibilityFor('student-1');
      expect(res.eligible).toBe(false);
      expect(res.rules).toEqual({
        requiredStories: 3,
        requiredChapters: 10,
        minQuizPercent: 80,
      });
    });
  });

  describe('getReadingProgress', () => {
    it('returns summary and stories correctly', async () => {
      prisma.readingProgress.findMany.mockResolvedValue([
        {
          id: 'rp-1',
          user_id: 'student-1',
          story_id: 'story-1',
          chapter_id: 'chap-1',
          page_number: 5,
          percent: 100,
          completed_at: new Date(),
          last_mode: ReadingMode.READ,
          updated_at: new Date(),
          story: {
            ...publishedStory,
            chapters: [{ id: 'chap-1' }, { id: 'chap-2' }],
          },
        },
      ]);
      prisma.chapterProgress.count
        .mockResolvedValueOnce(3) // total chapters completed
        .mockResolvedValueOnce(2); // story-1 chapters completed

      const res = await service.getReadingProgress('student-1');

      expect(res.success).toBe(true);
      expect(res.data.summary).toEqual({
        storiesStarted: 1,
        storiesCompleted: 1,
        chaptersCompleted: 3,
      });
      expect(res.data.stories).toHaveLength(1);
      expect(res.data.stories[0]).toMatchObject({
        storyId: 'story-1',
        title: 'Kind Wings',
        percent: 100,
        chaptersCompleted: 2,
      });
    });
  });
});
