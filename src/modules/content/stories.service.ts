import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  AgeGroup,
  Prisma,
  PublishStatus,
  Role,
  StoryCategory,
} from 'prisma/generated/client';
import { paginateResponse } from '../../common/pagination/pagination.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StudentStoryQueryDto } from './dto/story-list.dto';
import {
  CreateChapterDto,
  CreateStoryDto,
  PutAudioDto,
  PutPagesDto,
  StoryListQueryDto,
  UpdateStoryDto,
} from './dto/story.dto';

@Injectable()
export class StoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(adminId: string, query: StoryListQueryDto) {
    const schoolId = await this.adminSchool(adminId);
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const where = {
      deleted_at: null,
      school_id: schoolId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.story.count({ where }),
      this.prisma.story.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { updated_at: 'desc' },
      }),
    ]);
    return {
      success: true,
      data: paginateResponse(
        rows.map((row) => this.toStory(row)),
        total,
        page,
        perPage,
      ),
    };
  }

  async detail(adminId: string, storyId: string) {
    const schoolId = await this.adminSchool(adminId);
    const story = await this.storyInSchool(storyId, schoolId, true);
    return { success: true, data: this.toStoryDetail(story) };
  }

  async create(adminId: string, dto: CreateStoryDto) {
    const schoolId = await this.adminSchool(adminId);
    const created = await this.prisma.story.create({
      data: {
        school_id: schoolId,
        created_by_id: adminId,
        title: dto.title.trim(),
        synopsis: dto.synopsis?.trim() || null,
        cover_url: dto.coverUrl?.trim() || null,
        category: dto.category,
        age_group: dto.ageGroup,
        status: PublishStatus.DRAFT,
        estimated_minutes: dto.estimatedMinutes ?? null,
        chapter_count: 0,
      },
    });
    return {
      success: true,
      message: 'Story created',
      data: this.toStory(created),
    };
  }

  async update(adminId: string, storyId: string, dto: UpdateStoryDto) {
    const schoolId = await this.adminSchool(adminId);
    await this.storyInSchool(storyId, schoolId);
    const updated = await this.prisma.story.update({
      where: { id: storyId },
      data: {
        ...(dto.title ? { title: dto.title.trim() } : {}),
        ...(dto.synopsis !== undefined
          ? { synopsis: dto.synopsis.trim() || null }
          : {}),
        ...(dto.coverUrl !== undefined
          ? { cover_url: dto.coverUrl.trim() || null }
          : {}),
        ...(dto.category ? { category: dto.category } : {}),
        ...(dto.ageGroup ? { age_group: dto.ageGroup } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.estimatedMinutes !== undefined
          ? { estimated_minutes: dto.estimatedMinutes }
          : {}),
      },
    });
    return {
      success: true,
      message: 'Story updated',
      data: this.toStory(updated),
    };
  }

  async addChapter(adminId: string, storyId: string, dto: CreateChapterDto) {
    const schoolId = await this.adminSchool(adminId);
    await this.storyInSchool(storyId, schoolId);
    const number = dto.number ?? (await this.nextChapterNumber(storyId));
    if (dto.number != null) {
      const taken = await this.prisma.chapter.findFirst({
        where: { story_id: storyId, number: dto.number },
      });
      if (taken) {
        throw new HttpException(
          'Chapter number already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    let created: { id: string; number: number; title: string };
    try {
      created = await this.prisma.chapter.create({
        data: {
          story_id: storyId,
          number,
          title: dto.title.trim(),
          page_count: 0,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException(
          'Chapter number already exists',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    const chapterCount = await this.prisma.chapter.count({
      where: { story_id: storyId },
    });
    await this.prisma.story.update({
      where: { id: storyId },
      data: { chapter_count: chapterCount },
    });
    return {
      success: true,
      message: 'Chapter added',
      data: {
        id: created.id,
        number: created.number,
        title: created.title,
        pageCount: 0,
      },
    };
  }

  async replacePages(adminId: string, chapterId: string, dto: PutPagesDto) {
    const schoolId = await this.adminSchool(adminId);
    await this.chapterInSchool(chapterId, schoolId);
    const numbers = new Set<number>();
    for (const page of dto.pages) {
      if (numbers.has(page.number)) {
        throw new HttpException(
          'Page numbers must be unique',
          HttpStatus.BAD_REQUEST,
        );
      }
      numbers.add(page.number);
    }

    await this.prisma.page.deleteMany({ where: { chapter_id: chapterId } });
    if (dto.pages.length) {
      await this.prisma.page.createMany({
        data: dto.pages.map((page) => ({
          chapter_id: chapterId,
          number: page.number,
          body_text: page.bodyText?.trim() || null,
          image_url: page.imageUrl?.trim() || null,
        })),
      });
    }
    await this.prisma.chapter.update({
      where: { id: chapterId },
      data: { page_count: dto.pages.length },
    });
    return {
      success: true,
      message: 'Pages saved',
      data: { chapterId, pageCount: dto.pages.length },
    };
  }

  async putAudio(adminId: string, chapterId: string, dto: PutAudioDto) {
    const schoolId = await this.adminSchool(adminId);
    await this.chapterInSchool(chapterId, schoolId);
    const existing = await this.prisma.chapterAudio.findFirst({
      where: { chapter_id: chapterId },
    });
    const data = {
      audio_url: dto.audioUrl.trim(),
      duration_ms: dto.durationMs ?? null,
    };
    const saved = existing
      ? await this.prisma.chapterAudio.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.chapterAudio.create({
          data: { chapter_id: chapterId, ...data },
        });
    return {
      success: true,
      message: 'Audio saved',
      data: {
        id: saved.id,
        chapterId,
        audioUrl: saved.audio_url,
        durationMs: saved.duration_ms,
      },
    };
  }

  async studentList(studentId: string, query: StudentStoryQueryDto) {
    const schoolId = await this.studentSchool(studentId);
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const search = query.search?.trim();
    const where = {
      deleted_at: null,
      school_id: schoolId,
      status: PublishStatus.PUBLISHED,
      ...(query.category ? { category: query.category } : {}),
      ...(query.ageGroup ? { age_group: query.ageGroup } : {}),
      ...(search
        ? { title: { contains: search, mode: 'insensitive' as const } }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.story.count({ where }),
      this.prisma.story.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { title: 'asc' },
      }),
    ]);
    return {
      success: true,
      data: paginateResponse(
        rows.map((row) => this.toStudentStory(row)),
        total,
        page,
        perPage,
      ),
    };
  }

  async studentDetail(studentId: string, storyId: string) {
    const schoolId = await this.studentSchool(studentId);
    const story = await this.publishedStory(storyId, schoolId);
    const progress = await this.prisma.readingProgress.findFirst({
      where: { user_id: studentId, story_id: story.id },
    });
    return {
      success: true,
      data: {
        ...this.toStudentStory(story),
        progress: progress
          ? {
              percent: progress.percent,
              chapterId: progress.chapter_id,
              pageNumber: progress.page_number,
            }
          : null,
        chapters: (story.chapters ?? []).map((chapter) => ({
          id: chapter.id,
          number: chapter.number,
          title: chapter.title,
          pageCount: chapter.page_count ?? 0,
        })),
      },
    };
  }

  async studentChapter(studentId: string, storyId: string, chapterId: string) {
    const schoolId = await this.studentSchool(studentId);
    const story = await this.publishedStory(storyId, schoolId);
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, story_id: story.id },
      include: {
        pages: { orderBy: { number: 'asc' } },
        audio: true,
      },
    });
    if (!chapter) {
      throw new HttpException('Chapter not found', HttpStatus.NOT_FOUND);
    }
    return {
      success: true,
      data: {
        id: chapter.id,
        number: chapter.number,
        title: chapter.title,
        audioUrl: chapter.audio?.audio_url ?? null,
        pages: chapter.pages.map((page) => ({
          number: page.number,
          bodyText: page.body_text,
          imageUrl: page.image_url,
        })),
      },
    };
  }

  private async studentSchool(userId: string) {
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
    return user.school_id;
  }

  private async publishedStory(storyId: string, schoolId: string) {
    const story = await this.prisma.story.findFirst({
      where: {
        id: storyId,
        school_id: schoolId,
        status: PublishStatus.PUBLISHED,
        deleted_at: null,
      },
      include: {
        chapters: { orderBy: { number: 'asc' } },
      },
    });
    if (!story) {
      throw new HttpException('Story not found', HttpStatus.NOT_FOUND);
    }
    return story;
  }

  private toStudentStory(row: {
    id: string;
    title: string;
    synopsis: string | null;
    cover_url: string | null;
    category: StoryCategory;
    age_group: AgeGroup;
    estimated_minutes: number | null;
    chapter_count: number;
  }) {
    return {
      id: row.id,
      title: row.title,
      synopsis: row.synopsis,
      coverUrl: row.cover_url,
      category: row.category,
      ageGroup: row.age_group,
      estimatedMinutes: row.estimated_minutes,
      chapterCount: row.chapter_count,
    };
  }

  private async nextChapterNumber(storyId: string) {
    const last = await this.prisma.chapter.findFirst({
      where: { story_id: storyId },
      orderBy: { number: 'desc' },
    });
    return (last?.number ?? 0) + 1;
  }

  private toStory(row: {
    id: string;
    title: string;
    synopsis: string | null;
    cover_url: string | null;
    category: StoryCategory;
    age_group: AgeGroup;
    status: PublishStatus;
    estimated_minutes: number | null;
    chapter_count: number;
  }) {
    return {
      id: row.id,
      title: row.title,
      synopsis: row.synopsis,
      coverUrl: row.cover_url,
      category: row.category,
      ageGroup: row.age_group,
      status: row.status,
      estimatedMinutes: row.estimated_minutes,
      chapterCount: row.chapter_count,
    };
  }

  private toStoryDetail(row: {
    id: string;
    title: string;
    synopsis: string | null;
    cover_url: string | null;
    category: StoryCategory;
    age_group: AgeGroup;
    status: PublishStatus;
    estimated_minutes: number | null;
    chapter_count: number;
    chapters?: Array<{
      id: string;
      number: number;
      title: string;
      page_count: number | null;
      pages: Array<{
        id: string;
        number: number;
        body_text: string | null;
        image_url: string | null;
      }>;
      audio: {
        id: string;
        audio_url: string;
        duration_ms: number | null;
      } | null;
    }>;
  }) {
    return {
      ...this.toStory(row),
      chapters: (row.chapters ?? []).map((chapter) => ({
        id: chapter.id,
        number: chapter.number,
        title: chapter.title,
        pageCount: chapter.page_count ?? 0,
        pages: chapter.pages.map((page) => ({
          id: page.id,
          number: page.number,
          bodyText: page.body_text,
          imageUrl: page.image_url,
        })),
        audio: chapter.audio
          ? {
              id: chapter.audio.id,
              audioUrl: chapter.audio.audio_url,
              durationMs: chapter.audio.duration_ms,
            }
          : null,
      })),
    };
  }

  private async adminSchool(userId: string) {
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

  private async storyInSchool(
    storyId: string,
    schoolId: string,
    withChapters = false,
  ) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, deleted_at: null },
      ...(withChapters
        ? {
            include: {
              chapters: {
                orderBy: { number: 'asc' },
                include: {
                  pages: { orderBy: { number: 'asc' } },
                  audio: true,
                },
              },
            },
          }
        : {}),
    });
    if (!story) {
      throw new HttpException('Story not found', HttpStatus.NOT_FOUND);
    }
    if (story.school_id !== schoolId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    return story;
  }

  private async chapterInSchool(chapterId: string, schoolId: string) {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId },
      include: { story: true },
    });
    if (!chapter || chapter.story.deleted_at) {
      throw new HttpException('Chapter not found', HttpStatus.NOT_FOUND);
    }
    if (chapter.story.school_id !== schoolId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    return chapter;
  }
}
