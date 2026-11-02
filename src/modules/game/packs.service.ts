import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  AgeGroup,
  PublishStatus,
  QuestionType,
  Role,
  RoundType,
} from 'prisma/generated/client';
import { paginateResponse } from '../../common/pagination/pagination.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePackDto,
  PackListQueryDto,
  PackQuestionInputDto,
  UpdatePackDto,
} from './dto/pack.dto';

const REQUIRED_ROUND_TYPES = [
  RoundType.Q1_WARMUP,
  RoundType.Q2_DEFENSE,
  RoundType.Q3_HOBBY,
  RoundType.Q4_FINALS,
];

@Injectable()
export class PacksService {
  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------
  // Teacher endpoints
  // ----------------------------------------------------

  async listTeacherPacks(teacherId: string, query: PackListQueryDto) {
    const schoolId = await this.getTeacherSchool(teacherId);
    return this.listPacksInternal(schoolId, query);
  }

  async getTeacherPack(teacherId: string, packId: string) {
    const schoolId = await this.getTeacherSchool(teacherId);
    const pack = await this.getPackWithRelations(packId);
    if (!pack) {
      throw new HttpException('Game pack not found', HttpStatus.NOT_FOUND);
    }
    if (pack.school_id !== schoolId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    return {
      success: true,
      data: this.toPackDetail(pack),
    };
  }

  async createTeacherPack(teacherId: string, dto: CreatePackDto) {
    const schoolId = await this.getTeacherSchool(teacherId);
    const pack = await this.createPackInternal(schoolId, teacherId, dto);
    return {
      success: true,
      message: 'Game pack created',
      data: this.toPackDetail(pack),
    };
  }

  async updateTeacherPack(
    teacherId: string,
    packId: string,
    dto: UpdatePackDto,
  ) {
    const schoolId = await this.getTeacherSchool(teacherId);
    const existing = await this.getPackWithRelations(packId);
    if (!existing) {
      throw new HttpException('Game pack not found', HttpStatus.NOT_FOUND);
    }
    if (existing.school_id !== schoolId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const updated = await this.updatePackInternal(existing, dto);
    return {
      success: true,
      message: 'Game pack updated',
      data: this.toPackDetail(updated),
    };
  }

  async deleteTeacherPack(teacherId: string, packId: string) {
    const schoolId = await this.getTeacherSchool(teacherId);
    const existing = await this.prisma.gameQuestionPack.findUnique({
      where: { id: packId },
    });
    if (!existing) {
      throw new HttpException('Game pack not found', HttpStatus.NOT_FOUND);
    }
    if (existing.school_id !== schoolId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    await this.deletePackInternal(existing);
    return {
      success: true,
      message: 'Game pack deleted',
    };
  }

  // ----------------------------------------------------
  // Admin endpoints
  // ----------------------------------------------------

  async listAdminPacks(adminId: string, query: PackListQueryDto) {
    const requestedSchoolId = query.schoolId || query.school_id;
    const schoolId = await this.getAdminSchool(adminId, requestedSchoolId);
    return this.listPacksInternal(schoolId, query);
  }

  async getAdminPack(adminId: string, packId: string) {
    const admin = await this.prisma.user.findFirst({ where: { id: adminId } });
    if (!admin || admin.role !== Role.ADMIN) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const pack = await this.getPackWithRelations(packId);
    if (!pack) {
      throw new HttpException('Game pack not found', HttpStatus.NOT_FOUND);
    }
    if (admin.school_id && pack.school_id !== admin.school_id) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    return {
      success: true,
      data: this.toPackDetail(pack),
    };
  }

  async createAdminPack(adminId: string, dto: CreatePackDto) {
    const requestedSchoolId = dto.schoolId || dto.school_id;
    const schoolId = await this.getAdminSchool(adminId, requestedSchoolId);
    if (!schoolId) {
      throw new HttpException('School ID is required', HttpStatus.BAD_REQUEST);
    }

    const pack = await this.createPackInternal(schoolId, adminId, dto);
    return {
      success: true,
      message: 'Game pack created',
      data: this.toPackDetail(pack),
    };
  }

  async updateAdminPack(adminId: string, packId: string, dto: UpdatePackDto) {
    const admin = await this.prisma.user.findFirst({ where: { id: adminId } });
    if (!admin || admin.role !== Role.ADMIN) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const existing = await this.getPackWithRelations(packId);
    if (!existing) {
      throw new HttpException('Game pack not found', HttpStatus.NOT_FOUND);
    }
    if (admin.school_id && existing.school_id !== admin.school_id) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const updated = await this.updatePackInternal(existing, dto);
    return {
      success: true,
      message: 'Game pack updated',
      data: this.toPackDetail(updated),
    };
  }

  async deleteAdminPack(adminId: string, packId: string) {
    const admin = await this.prisma.user.findFirst({ where: { id: adminId } });
    if (!admin || admin.role !== Role.ADMIN) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const existing = await this.prisma.gameQuestionPack.findUnique({
      where: { id: packId },
    });
    if (!existing) {
      throw new HttpException('Game pack not found', HttpStatus.NOT_FOUND);
    }
    if (admin.school_id && existing.school_id !== admin.school_id) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    await this.deletePackInternal(existing);
    return {
      success: true,
      message: 'Game pack deleted',
    };
  }

  // ----------------------------------------------------
  // Internal common operations
  // ----------------------------------------------------

  private async listPacksInternal(
    schoolId: string | null,
    query: PackListQueryDto,
  ) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const search = (query.search || query.q)?.trim();
    const rawAgeGroup = query.ageGroup || query.age_group;
    const ageGroup = rawAgeGroup
      ? this.normalizeAgeGroup(rawAgeGroup)
      : undefined;
    const status = query.status
      ? this.normalizePublishStatus(query.status)
      : undefined;

    const where: any = {
      ...(schoolId ? { school_id: schoolId } : {}),
      ...(status ? { status } : {}),
      ...(ageGroup ? { age_group: ageGroup } : {}),
      ...(search
        ? { title: { contains: search, mode: 'insensitive' as const } }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.gameQuestionPack.count({ where }),
      this.prisma.gameQuestionPack.findMany({
        where,
        include: {
          stories: {
            include: {
              story: true,
            },
          },
          questions: {
            orderBy: [{ round_type: 'asc' }, { sort_order: 'asc' }],
          },
        },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { updated_at: 'desc' },
      }),
    ]);

    return {
      success: true,
      data: paginateResponse(
        rows.map((row) => this.toPackDetail(row)),
        total,
        page,
        perPage,
      ),
    };
  }

  private async createPackInternal(
    schoolId: string,
    creatorId: string,
    dto: CreatePackDto,
  ) {
    const status = dto.status
      ? this.normalizePublishStatus(dto.status)
      : PublishStatus.DRAFT;
    const ageGroup = this.normalizeAgeGroup(dto.ageGroup || dto.age_group);
    const storyIds = dto.storyIds || dto.story_ids || [];

    await this.validateStories(schoolId, storyIds);

    const questionsInput = dto.questions || [];
    const preparedQuestions = questionsInput.map((q, idx) =>
      this.prepareQuestionData(q, idx),
    );

    if (status === PublishStatus.PUBLISHED) {
      this.validatePublishedQuestions(preparedQuestions);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const pack = await tx.gameQuestionPack.create({
        data: {
          school_id: schoolId,
          created_by_id: creatorId,
          title: dto.title.trim(),
          age_group: ageGroup,
          status,
        },
      });

      if (storyIds.length > 0) {
        const uniqueStoryIds = [...new Set(storyIds)];
        await tx.gamePackStory.createMany({
          data: uniqueStoryIds.map((storyId) => ({
            pack_id: pack.id,
            story_id: storyId,
          })),
        });
      }

      if (preparedQuestions.length > 0) {
        await tx.gamePackQuestion.createMany({
          data: preparedQuestions.map((q) => ({
            pack_id: pack.id,
            round_type: q.round_type,
            sort_order: q.sort_order,
            type: q.type,
            prompt: q.prompt,
            options_json: q.options_json,
            meta_json: q.meta_json,
          })),
        });
      }

      return tx.gameQuestionPack.findUnique({
        where: { id: pack.id },
        include: {
          stories: { include: { story: true } },
          questions: {
            orderBy: [{ round_type: 'asc' }, { sort_order: 'asc' }],
          },
        },
      });
    });

    return created!;
  }

  private async updatePackInternal(existingPack: any, dto: UpdatePackDto) {
    const schoolId = existingPack.school_id;
    const rawStatus = dto.status;
    const targetStatus = rawStatus
      ? this.normalizePublishStatus(rawStatus)
      : existingPack.status;

    const rawAgeGroup = dto.ageGroup || dto.age_group;
    const targetAgeGroup = rawAgeGroup
      ? this.normalizeAgeGroup(rawAgeGroup)
      : existingPack.age_group;

    const storyIds = dto.storyIds ?? dto.story_ids;
    if (storyIds) {
      await this.validateStories(schoolId, storyIds);
    }

    let preparedQuestions: any[] | null = null;
    if (dto.questions) {
      preparedQuestions = dto.questions.map((q, idx) =>
        this.prepareQuestionData(q, idx),
      );
    }

    if (targetStatus === PublishStatus.PUBLISHED) {
      const questionsToCheck =
        preparedQuestions !== null ? preparedQuestions : existingPack.questions;
      this.validatePublishedQuestions(questionsToCheck);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.gameQuestionPack.update({
        where: { id: existingPack.id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(rawAgeGroup !== undefined ? { age_group: targetAgeGroup } : {}),
          ...(rawStatus !== undefined ? { status: targetStatus } : {}),
        },
      });

      if (storyIds !== undefined) {
        await tx.gamePackStory.deleteMany({
          where: { pack_id: existingPack.id },
        });
        const uniqueStoryIds = [...new Set(storyIds)];
        if (uniqueStoryIds.length > 0) {
          await tx.gamePackStory.createMany({
            data: uniqueStoryIds.map((storyId) => ({
              pack_id: existingPack.id,
              story_id: storyId,
            })),
          });
        }
      }

      if (preparedQuestions !== null) {
        await tx.gamePackQuestion.deleteMany({
          where: { pack_id: existingPack.id },
        });
        if (preparedQuestions.length > 0) {
          await tx.gamePackQuestion.createMany({
            data: preparedQuestions.map((q) => ({
              pack_id: existingPack.id,
              round_type: q.round_type,
              sort_order: q.sort_order,
              type: q.type,
              prompt: q.prompt,
              options_json: q.options_json,
              meta_json: q.meta_json,
            })),
          });
        }
      }

      return tx.gameQuestionPack.findUnique({
        where: { id: existingPack.id },
        include: {
          stories: { include: { story: true } },
          questions: {
            orderBy: [{ round_type: 'asc' }, { sort_order: 'asc' }],
          },
        },
      });
    });

    return updated!;
  }

  private async deletePackInternal(pack: {
    id: string;
    status: PublishStatus;
  }) {
    if (pack.status === PublishStatus.PUBLISHED) {
      throw new HttpException(
        'Cannot delete published pack (D50)',
        HttpStatus.CONFLICT,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.gamePackQuestion.deleteMany({ where: { pack_id: pack.id } });
      await tx.gamePackStory.deleteMany({ where: { pack_id: pack.id } });
      await tx.gameQuestionPack.delete({ where: { id: pack.id } });
    });
  }

  // ----------------------------------------------------
  // Validation and normalization helpers
  // ----------------------------------------------------

  private async getTeacherSchool(teacherId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({ where: { id: teacherId } });
    if (!user || user.role !== Role.TEACHER) {
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

  private async getAdminSchool(
    adminId: string,
    requestedSchoolId?: string,
  ): Promise<string | null> {
    const admin = await this.prisma.user.findFirst({ where: { id: adminId } });
    if (!admin || admin.role !== Role.ADMIN) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    if (admin.school_id) {
      if (requestedSchoolId && requestedSchoolId !== admin.school_id) {
        throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      }
      return admin.school_id;
    }

    return requestedSchoolId || null;
  }

  private async getPackWithRelations(packId: string) {
    return this.prisma.gameQuestionPack.findUnique({
      where: { id: packId },
      include: {
        stories: {
          include: {
            story: true,
          },
        },
        questions: {
          orderBy: [{ round_type: 'asc' }, { sort_order: 'asc' }],
        },
      },
    });
  }

  private async validateStories(schoolId: string, storyIds: string[]) {
    if (!storyIds || storyIds.length === 0) return;

    for (const storyId of storyIds) {
      const story = await this.prisma.story.findFirst({
        where: { id: storyId, deleted_at: null },
      });

      if (!story) {
        throw new HttpException(
          `Story not found: ${storyId}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      if (story.school_id !== schoolId) {
        throw new HttpException(
          `Story from another school: ${storyId}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      if (story.status !== PublishStatus.PUBLISHED) {
        throw new HttpException(
          `Story must be published: ${storyId}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  private validatePublishedQuestions(
    questions: Array<{ round_type: RoundType }>,
  ) {
    const presentTypes = new Set(questions.map((q) => q.round_type));
    for (const reqType of REQUIRED_ROUND_TYPES) {
      if (!presentTypes.has(reqType)) {
        throw new HttpException(
          `Cannot publish pack: missing question for round ${reqType}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  private prepareQuestionData(q: PackQuestionInputDto, index: number) {
    const rawRoundType = q.roundType || q.round_type;
    const round_type = this.normalizeRoundType(rawRoundType);
    const sort_order = q.sortOrder ?? q.sort_order ?? index + 1;
    const type = q.type ?? QuestionType.MCQ;
    const prompt = q.prompt?.trim() || '';

    let options_json: any = q.options_json ?? q.optionsJson;
    if (!options_json) {
      if (q.options && Array.isArray(q.options)) {
        options_json = {
          options: q.options,
          correctIndex: q.correctIndex ?? 0,
        };
      } else {
        options_json = {
          options: [],
          correctIndex: 0,
        };
      }
    }

    const meta_json = q.meta_json ?? q.metaJson ?? null;

    return {
      round_type,
      sort_order,
      type,
      prompt,
      options_json,
      meta_json,
    };
  }

  normalizeRoundType(rt?: string | RoundType): RoundType {
    if (!rt) return RoundType.Q1_WARMUP;
    const upper = String(rt).toUpperCase().trim();
    if (
      upper === 'Q1' ||
      upper === 'Q1_WARMUP' ||
      upper === 'WARMUP' ||
      upper === 'WARM_UP'
    ) {
      return RoundType.Q1_WARMUP;
    }
    if (upper === 'Q2' || upper === 'Q2_DEFENSE' || upper === 'DEFENSE') {
      return RoundType.Q2_DEFENSE;
    }
    if (upper === 'Q3' || upper === 'Q3_HOBBY' || upper === 'HOBBY') {
      return RoundType.Q3_HOBBY;
    }
    if (upper === 'Q4' || upper === 'Q4_FINALS' || upper === 'FINALS') {
      return RoundType.Q4_FINALS;
    }
    if (Object.values(RoundType).includes(upper as RoundType)) {
      return upper as RoundType;
    }
    throw new HttpException(
      `Invalid round type: ${rt}`,
      HttpStatus.BAD_REQUEST,
    );
  }

  normalizeAgeGroup(ag?: string | AgeGroup): AgeGroup {
    if (!ag) return AgeGroup.AGE_6_9;
    const upper = String(ag).toUpperCase().trim();
    if (upper === 'AGE_6_9' || upper === '6-9' || upper === '6_9') {
      return AgeGroup.AGE_6_9;
    }
    if (upper === 'AGE_10_13' || upper === '10-13' || upper === '10_13') {
      return AgeGroup.AGE_10_13;
    }
    if (upper === 'ADULTS' || upper === 'ADULT') {
      return AgeGroup.ADULTS;
    }
    if (Object.values(AgeGroup).includes(upper as AgeGroup)) {
      return upper as AgeGroup;
    }
    throw new HttpException(`Invalid age group: ${ag}`, HttpStatus.BAD_REQUEST);
  }

  normalizePublishStatus(st?: string | PublishStatus): PublishStatus {
    if (!st) return PublishStatus.DRAFT;
    const upper = String(st).toUpperCase().trim();
    if (upper === 'PUBLISHED') return PublishStatus.PUBLISHED;
    if (upper === 'DRAFT') return PublishStatus.DRAFT;
    if (Object.values(PublishStatus).includes(upper as PublishStatus)) {
      return upper as PublishStatus;
    }
    throw new HttpException(
      `Invalid publish status: ${st}`,
      HttpStatus.BAD_REQUEST,
    );
  }

  toPackDetail(pack: any) {
    const stories = (pack.stories ?? []).map((s: any) => ({
      id: s.id,
      storyId: s.story_id,
      story_id: s.story_id,
      story: s.story
        ? {
            id: s.story.id,
            title: s.story.title,
            coverUrl: s.story.cover_url,
            cover_url: s.story.cover_url,
            category: s.story.category,
            ageGroup: s.story.age_group,
            age_group: s.story.age_group,
            status: s.story.status,
          }
        : undefined,
    }));

    const questions = (pack.questions ?? []).map((q: any) => ({
      id: q.id,
      packId: q.pack_id,
      pack_id: q.pack_id,
      roundType: q.round_type,
      round_type: q.round_type,
      sortOrder: q.sort_order,
      sort_order: q.sort_order,
      type: q.type,
      prompt: q.prompt,
      optionsJson: q.options_json,
      options_json: q.options_json,
      metaJson: q.meta_json,
      meta_json: q.meta_json,
      createdAt: q.created_at,
      created_at: q.created_at,
      updatedAt: q.updated_at,
      updated_at: q.updated_at,
    }));

    const storyIds = pack.stories?.map((s: any) => s.story_id) ?? [];

    return {
      id: pack.id,
      schoolId: pack.school_id,
      school_id: pack.school_id,
      title: pack.title,
      ageGroup: pack.age_group,
      age_group: pack.age_group,
      status: pack.status,
      createdById: pack.created_by_id,
      created_by_id: pack.created_by_id,
      createdAt: pack.created_at,
      created_at: pack.created_at,
      updatedAt: pack.updated_at,
      updated_at: pack.updated_at,
      storyIds,
      story_ids: storyIds,
      stories,
      questions,
    };
  }
}
