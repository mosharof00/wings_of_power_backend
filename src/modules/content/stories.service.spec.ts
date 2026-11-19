import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AgeGroup,
  PublishStatus,
  Role,
  UserStatus,
} from 'prisma/generated/client';
import { ActiveStudentGuard } from '../../common/guard/role/active-student.guard';
import { UserRepository } from '../../common/repository/user/user.repository';
import { Role as GuardRole } from '../../common/guard/role/role.enum';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminStoriesController } from './admin-stories.controller';
import { StoriesService } from './stories.service';

describe('StoriesService', () => {
  const prisma = {
    user: { findFirst: jest.fn() },
    storyTheme: { findFirst: jest.fn() },
    story: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    chapter: {
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    page: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    chapterAudio: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    readingProgress: {
      findFirst: jest.fn(),
    },
    chapterProgress: {
      findMany: jest.fn(),
    },
    quiz: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    pageRead: {
      findMany: jest.fn(),
    },
  };
  const service = new StoriesService(prisma as unknown as PrismaService);

  const admin = {
    id: 'admin-1',
    role: Role.ADMIN,
    school_id: 'school-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findFirst.mockReset();
    prisma.storyTheme.findFirst.mockReset();
    prisma.chapter.findFirst.mockReset();
    prisma.chapterAudio.findFirst.mockReset();
    prisma.quiz.findFirst.mockReset();
    prisma.quiz.findMany.mockReset();
    prisma.pageRead.findMany.mockReset();
    prisma.chapterProgress.findMany.mockReset();
    prisma.storyTheme.findFirst.mockResolvedValue({
      id: 'theme_kindness',
      is_active: true,
    });
    prisma.quiz.findFirst.mockResolvedValue(null);
    prisma.quiz.findMany.mockResolvedValue([]);
    prisma.pageRead.findMany.mockResolvedValue([]);
    prisma.chapterProgress.findMany.mockResolvedValue([]);
  });

  it('create is DRAFT and scoped to the admin school', async () => {
    prisma.user.findFirst.mockResolvedValue(admin);
    prisma.storyTheme.findFirst.mockResolvedValue({
      id: 'theme_kindness',
      is_active: true,
    });
    prisma.story.create.mockImplementation(async ({ data }) => ({
      id: 'story-1',
      ...data,
    }));

    const result = await service.create('admin-1', {
      title: 'The Kindness Bridge',
      themeId: 'theme_kindness',
      ageGroup: AgeGroup.AGE_6_9,
    });

    expect(prisma.story.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          school_id: 'school-1',
          theme_id: 'theme_kindness',
          status: PublishStatus.DRAFT,
          chapter_count: 0,
        }),
        include: { theme: true },
      }),
    );
    expect(result.data.status).toBe(PublishStatus.DRAFT);
    expect(result.data.ageGroup).toBe(AgeGroup.AGE_6_9);
  });

  it('patch to PUBLISHED persists theme and age group', async () => {
    prisma.user.findFirst.mockResolvedValue(admin);
    prisma.storyTheme.findFirst.mockResolvedValue({
      id: 'theme_courage',
      is_active: true,
    });
    prisma.story.findFirst.mockResolvedValue({
      id: 'story-1',
      school_id: 'school-1',
      deleted_at: null,
    });
    prisma.story.update.mockImplementation(async ({ data }) => ({
      id: 'story-1',
      title: 'The Kindness Bridge',
      synopsis: null,
      cover_url: null,
      estimated_minutes: null,
      chapter_count: 0,
      theme_id: data.theme_id,
      ...data,
    }));

    const result = await service.update('admin-1', 'story-1', {
      status: PublishStatus.PUBLISHED,
      themeId: 'theme_courage',
      ageGroup: AgeGroup.AGE_10_13,
    });

    expect(prisma.story.update).toHaveBeenCalledWith({
      where: { id: 'story-1' },
      data: {
        theme_id: 'theme_courage',
        age_group: AgeGroup.AGE_10_13,
        status: PublishStatus.PUBLISHED,
      },
      include: { theme: true },
    });
    expect(result.data.status).toBe(PublishStatus.PUBLISHED);
    expect(result.data.themeId).toBe('theme_courage');
    expect(result.data.ageGroup).toBe(AgeGroup.AGE_10_13);
  });

  it('second chapter number collides with 409', async () => {
    prisma.user.findFirst.mockResolvedValue(admin);
    prisma.story.findFirst.mockResolvedValue({
      id: 'story-1',
      school_id: 'school-1',
      deleted_at: null,
    });
    prisma.chapter.findFirst.mockResolvedValue({ id: 'ch-1', number: 1 });

    try {
      await service.addChapter('admin-1', 'story-1', {
        title: 'Again',
        number: 1,
      });
      throw new Error('expected conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(409);
    }
    expect(prisma.chapter.create).not.toHaveBeenCalled();
  });

  it('pages PUT replaces previous pages', async () => {
    prisma.user.findFirst.mockResolvedValue(admin);
    prisma.chapter.findFirst.mockResolvedValue({
      id: 'ch-1',
      story: { id: 'story-1', school_id: 'school-1', deleted_at: null },
    });
    prisma.page.deleteMany.mockResolvedValue({ count: 3 });
    prisma.page.createMany.mockResolvedValue({ count: 2 });
    prisma.chapter.update.mockResolvedValue({});

    await service.replacePages('admin-1', 'ch-1', {
      pages: [
        { number: 1, bodyText: 'One', imageUrl: 'https://cdn/1.png' },
        { number: 2, bodyText: 'Two' },
      ],
    });

    expect(prisma.page.deleteMany).toHaveBeenCalledWith({
      where: { chapter_id: 'ch-1' },
    });
    expect(prisma.page.createMany).toHaveBeenCalledWith({
      data: [
        {
          chapter_id: 'ch-1',
          number: 1,
          body_text: 'One',
          image_url: 'https://cdn/1.png',
        },
        {
          chapter_id: 'ch-1',
          number: 2,
          body_text: 'Two',
          image_url: null,
        },
      ],
    });
    expect(prisma.chapter.update).toHaveBeenCalledWith({
      where: { id: 'ch-1' },
      data: { page_count: 2 },
    });
  });

  it('audio PUT updates the same row on the second call', async () => {
    prisma.user.findFirst.mockResolvedValue(admin);
    prisma.chapter.findFirst.mockResolvedValue({
      id: 'ch-1',
      story: { id: 'story-1', school_id: 'school-1', deleted_at: null },
    });
    prisma.chapterAudio.findFirst.mockResolvedValueOnce(null);
    prisma.chapterAudio.create.mockResolvedValue({
      id: 'audio-1',
      audio_url: 'https://cdn/a.mp3',
      duration_ms: 1000,
    });

    await service.putAudio('admin-1', 'ch-1', {
      audioUrl: 'https://cdn/a.mp3',
      durationMs: 1000,
    });

    prisma.chapterAudio.findFirst.mockResolvedValueOnce({
      id: 'audio-1',
      chapter_id: 'ch-1',
    });
    prisma.chapterAudio.update.mockResolvedValue({
      id: 'audio-1',
      audio_url: 'https://cdn/b.mp3',
      duration_ms: 2000,
    });

    const second = await service.putAudio('admin-1', 'ch-1', {
      audioUrl: 'https://cdn/b.mp3',
      durationMs: 2000,
    });

    expect(prisma.chapterAudio.create).toHaveBeenCalledTimes(1);
    expect(prisma.chapterAudio.update).toHaveBeenCalledWith({
      where: { id: 'audio-1' },
      data: { audio_url: 'https://cdn/b.mp3', duration_ms: 2000 },
    });
    expect(second.data.id).toBe('audio-1');
  });

  it('teacher token is 403', async () => {
    const reflector = new Reflector();
    const users = {
      getUserDetails: jest.fn().mockResolvedValue({ role: GuardRole.TEACHER }),
    };
    const guard = new RolesGuard(reflector, users as unknown as UserRepository);
    const context = {
      getHandler: () => AdminStoriesController.prototype.list,
      getClass: () => AdminStoriesController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: 'teacher-1' } }),
      }),
    } as unknown as ExecutionContext;

    try {
      await guard.canActivate(context);
      throw new Error('expected forbidden');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
    }
  });

  const student = {
    id: 'student-1',
    role: Role.STUDENT,
    school_id: 'school-1',
    status: UserStatus.ACTIVE,
  };

  it('admin list filters by search and age group', async () => {
    prisma.user.findFirst.mockResolvedValue(admin);
    prisma.story.count.mockResolvedValue(0);
    prisma.story.findMany.mockResolvedValue([]);

    await service.list('admin-1', {
      page: 1,
      perPage: 15,
      q: '  Lion ',
      ageGroup: AgeGroup.AGE_6_9,
      status: PublishStatus.DRAFT,
    });

    expect(prisma.story.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          school_id: 'school-1',
          status: PublishStatus.DRAFT,
          age_group: AgeGroup.AGE_6_9,
          title: { contains: 'Lion', mode: 'insensitive' },
        }),
        include: { theme: true },
      }),
    );
  });

  it('hides drafts and other schools', async () => {
    prisma.user.findFirst.mockResolvedValue(student);
    prisma.story.count.mockResolvedValue(0);
    prisma.story.findMany.mockResolvedValue([]);

    await service.studentList('student-1', { page: 1, perPage: 10 });

    expect(prisma.story.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deleted_at: null,
          school_id: 'school-1',
          status: PublishStatus.PUBLISHED,
        },
      }),
    );
  });

  it('filters by search and category', async () => {
    prisma.user.findFirst.mockResolvedValue(student);
    prisma.story.count.mockResolvedValue(0);
    prisma.story.findMany.mockResolvedValue([]);

    await service.studentList('student-1', {
      page: 1,
      perPage: 10,
      search: '  Kind ',
      themeId: 'theme_kindness',
    });

    expect(prisma.story.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: PublishStatus.PUBLISHED,
          theme_id: 'theme_kindness',
          title: { contains: 'Kind', mode: 'insensitive' },
        }),
      }),
    );
  });

  it('chapter 404 when it belongs to another story', async () => {
    prisma.user.findFirst.mockResolvedValue(student);
    prisma.story.findFirst.mockResolvedValue({
      id: 'story-1',
      school_id: 'school-1',
      status: PublishStatus.PUBLISHED,
      chapters: [],
    });
    prisma.chapter.findFirst.mockResolvedValue(null);

    try {
      await service.studentChapter('student-1', 'story-1', 'ch-9');
      throw new Error('expected not found');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(404);
    }
    expect(prisma.chapter.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ch-9', story_id: 'story-1' },
      }),
    );
  });

  it('chapter pages omit staff-only fields', async () => {
    prisma.user.findFirst.mockResolvedValue(student);
    prisma.story.findFirst.mockResolvedValue({
      id: 'story-1',
      title: 'The Kindness Bridge',
      synopsis: null,
      cover_url: null,
      themeId: 'theme_kindness',
      age_group: AgeGroup.AGE_6_9,
      estimated_minutes: 8,
      chapter_count: 1,
      chapters: [],
    });
    prisma.chapter.findFirst.mockResolvedValue({
      id: 'ch-1',
      number: 1,
      title: 'Opening',
      story_id: 'story-1',
      created_by_id: 'admin-1',
      school_id: 'school-1',
      deleted_at: null,
      audio: {
        id: 'audio-1',
        audio_url: 'https://cdn/a.mp3',
        created_by_id: 'admin-1',
      },
      pages: [
        {
          id: 'page-1',
          chapter_id: 'ch-1',
          number: 1,
          body_text: 'Hello',
          image_url: 'https://cdn/1.png',
          created_at: new Date(),
          updated_at: new Date(),
          school_id: 'school-1',
        },
      ],
    });

    const result = await service.studentChapter('student-1', 'story-1', 'ch-1');

    expect(result.data.pages).toEqual([
      {
        number: 1,
        bodyText: 'Hello',
        imageUrl: 'https://cdn/1.png',
        isLocked: false,
        isRead: false,
        hasCheckpoint: false,
      },
    ]);
    expect(result.data.pages[0]).not.toHaveProperty('school_id');
    expect(result.data.pages[0]).not.toHaveProperty('created_at');
    expect(result.data.pages[0]).not.toHaveProperty('chapter_id');
    expect(result.data.audioUrl).toBe('https://cdn/a.mp3');
    expect(result.data).not.toHaveProperty('school_id');
    expect(result.data).not.toHaveProperty('created_by_id');
  });

  it('pending student is 422 from ActiveStudentGuard', async () => {
    const users = {
      getUserDetails: jest.fn().mockResolvedValue({
        role: GuardRole.STUDENT,
        status: UserStatus.PENDING,
      }),
    };
    const guard = new ActiveStudentGuard(users as unknown as UserRepository);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: 'student-1' } }),
      }),
    } as unknown as ExecutionContext;

    try {
      await guard.canActivate(context);
      throw new Error('expected pending');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(422);
      expect((error as HttpException).getResponse()).toBe('PENDING');
    }
  });
});
