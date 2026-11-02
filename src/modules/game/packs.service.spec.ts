import { HttpException, HttpStatus } from '@nestjs/common';
import {
  AgeGroup,
  PublishStatus,
  QuestionType,
  Role,
  RoundType,
} from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PacksService } from './packs.service';

describe('PacksService', () => {
  let service: PacksService;
  let prisma: any;

  const mockTeacher = {
    id: 'teacher-1',
    role: Role.TEACHER,
    school_id: 'school-1',
  };

  const mockAdmin = {
    id: 'admin-1',
    role: Role.ADMIN,
    school_id: 'school-1',
  };

  const mockAdminNoSchool = {
    id: 'admin-super',
    role: Role.ADMIN,
    school_id: null,
  };

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn(),
      },
      story: {
        findFirst: jest.fn(),
      },
      gameQuestionPack: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      gamePackStory: {
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      gamePackQuestion: {
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb: any) =>
        typeof cb === 'function' ? cb(prisma) : Promise.all(cb),
      ),
    };

    service = new PacksService(prisma as unknown as PrismaService);
  });

  describe('publish without a Q4 question -> 400', () => {
    it('rejects creating a published pack when Q4 question is missing', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher);

      const dto = {
        title: 'Missing Q4 Pack',
        status: PublishStatus.PUBLISHED,
        ageGroup: 'AGE_6_9',
        questions: [
          {
            roundType: 'Q1_WARMUP',
            prompt: 'Question 1',
            options_json: { options: ['A', 'B'], correctIndex: 0 },
          },
          {
            roundType: 'Q2_DEFENSE',
            prompt: 'Question 2',
            options_json: { options: ['C', 'D'], correctIndex: 1 },
          },
          {
            roundType: 'Q3_HOBBY',
            prompt: 'Question 3',
            options_json: { options: ['E', 'F'], correctIndex: 0 },
          },
          // Missing Q4_FINALS
        ],
      };

      try {
        await service.createTeacherPack('teacher-1', dto);
        fail('Should have thrown HttpException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(err.message).toContain('Q4_FINALS');
      }
    });

    it('rejects updating a pack to PUBLISHED when missing Q4 question', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher);

      prisma.gameQuestionPack.findUnique.mockResolvedValue({
        id: 'pack-draft-1',
        school_id: 'school-1',
        title: 'Draft Pack',
        status: PublishStatus.DRAFT,
        age_group: AgeGroup.AGE_6_9,
        stories: [],
        questions: [
          { round_type: RoundType.Q1_WARMUP, prompt: 'Q1' },
          { round_type: RoundType.Q2_DEFENSE, prompt: 'Q2' },
          { round_type: RoundType.Q3_HOBBY, prompt: 'Q3' },
          // No Q4
        ],
      });

      try {
        await service.updateTeacherPack('teacher-1', 'pack-draft-1', {
          status: PublishStatus.PUBLISHED,
        });
        fail('Should have thrown HttpException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(err.message).toContain('Q4_FINALS');
      }
    });

    it('allows draft creation with partial rounds', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher);
      const createdPack = {
        id: 'pack-new-1',
        school_id: 'school-1',
        title: 'Draft Partial Pack',
        status: PublishStatus.DRAFT,
        age_group: AgeGroup.AGE_6_9,
        created_by_id: 'teacher-1',
        created_at: new Date(),
        updated_at: new Date(),
        stories: [],
        questions: [
          {
            id: 'q-1',
            pack_id: 'pack-new-1',
            round_type: RoundType.Q1_WARMUP,
            sort_order: 1,
            type: QuestionType.MCQ,
            prompt: 'Q1 Warmup Prompt',
            options_json: { options: ['A', 'B'], correctIndex: 0 },
            meta_json: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      };

      prisma.gameQuestionPack.create.mockResolvedValue({ id: 'pack-new-1' });
      prisma.gameQuestionPack.findUnique.mockResolvedValue(createdPack);

      const result = await service.createTeacherPack('teacher-1', {
        title: 'Draft Partial Pack',
        status: PublishStatus.DRAFT,
        questions: [
          {
            roundType: 'Q1',
            prompt: 'Q1 Warmup Prompt',
            options: ['A', 'B'],
            correctIndex: 0,
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(PublishStatus.DRAFT);
      expect(result.data.questions.length).toBe(1);
    });

    it('succeeds publishing when all 4 rounds are present', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher);
      const fullPack = {
        id: 'pack-full-1',
        school_id: 'school-1',
        title: 'All Rounds Pack',
        status: PublishStatus.PUBLISHED,
        age_group: AgeGroup.AGE_10_13,
        created_by_id: 'teacher-1',
        created_at: new Date(),
        updated_at: new Date(),
        stories: [],
        questions: [
          {
            id: 'q1',
            pack_id: 'pack-full-1',
            round_type: RoundType.Q1_WARMUP,
            sort_order: 1,
            type: QuestionType.MCQ,
            prompt: 'Warmup',
            options_json: { options: ['A', 'B'], correctIndex: 0 },
            meta_json: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
          {
            id: 'q2',
            pack_id: 'pack-full-1',
            round_type: RoundType.Q2_DEFENSE,
            sort_order: 1,
            type: QuestionType.MCQ,
            prompt: 'Defense',
            options_json: { options: ['C', 'D'], correctIndex: 0 },
            meta_json: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
          {
            id: 'q3',
            pack_id: 'pack-full-1',
            round_type: RoundType.Q3_HOBBY,
            sort_order: 1,
            type: QuestionType.MCQ,
            prompt: 'Hobby',
            options_json: { options: ['E', 'F'], correctIndex: 0 },
            meta_json: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
          {
            id: 'q4',
            pack_id: 'pack-full-1',
            round_type: RoundType.Q4_FINALS,
            sort_order: 1,
            type: QuestionType.MCQ,
            prompt: 'Finals',
            options_json: { options: ['G', 'H'], correctIndex: 0 },
            meta_json: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      };

      prisma.gameQuestionPack.create.mockResolvedValue({ id: 'pack-full-1' });
      prisma.gameQuestionPack.findUnique.mockResolvedValue(fullPack);

      const result = await service.createTeacherPack('teacher-1', {
        title: 'All Rounds Pack',
        status: PublishStatus.PUBLISHED,
        ageGroup: 'AGE_10_13',
        questions: [
          { roundType: 'Q1', prompt: 'Warmup', options: ['A', 'B'] },
          { roundType: 'Q2', prompt: 'Defense', options: ['C', 'D'] },
          { roundType: 'Q3', prompt: 'Hobby', options: ['E', 'F'] },
          { roundType: 'Q4', prompt: 'Finals', options: ['G', 'H'] },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(PublishStatus.PUBLISHED);
      expect(result.data.questions.length).toBe(4);
    });
  });

  describe('story from another school -> 400', () => {
    it('throws 400 when a story belongs to a different school', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher);

      prisma.story.findFirst.mockResolvedValue({
        id: 'story-other-school',
        school_id: 'school-2', // Different school!
        status: PublishStatus.PUBLISHED,
        deleted_at: null,
      });

      try {
        await service.createTeacherPack('teacher-1', {
          title: 'Pack with External Story',
          storyIds: ['story-other-school'],
        });
        fail('Should have thrown HttpException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(err.message).toContain('Story from another school');
      }
    });

    it('throws 400 when a story is not published', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher);

      prisma.story.findFirst.mockResolvedValue({
        id: 'story-draft',
        school_id: 'school-1',
        status: PublishStatus.DRAFT, // Not published
        deleted_at: null,
      });

      try {
        await service.createTeacherPack('teacher-1', {
          title: 'Pack with Draft Story',
          storyIds: ['story-draft'],
        });
        fail('Should have thrown HttpException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(err.message).toContain('Story must be published');
      }
    });

    it('throws 400 when story is not found', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher);
      prisma.story.findFirst.mockResolvedValue(null);

      try {
        await service.createTeacherPack('teacher-1', {
          title: 'Pack with Missing Story',
          storyIds: ['non-existent-story'],
        });
        fail('Should have thrown HttpException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(err.message).toContain('Story not found');
      }
    });
  });

  describe("teacher cannot patch an admin's pack in another school", () => {
    it('throws 403 Forbidden when teacher tries to patch pack from another school', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher); // school_id: 'school-1'

      // Pack created by admin in school-2
      prisma.gameQuestionPack.findUnique.mockResolvedValue({
        id: 'admin-pack-school-2',
        school_id: 'school-2', // Different school!
        created_by_id: 'admin-2',
        title: 'Admin Pack in School 2',
        status: PublishStatus.DRAFT,
        age_group: AgeGroup.AGE_6_9,
        stories: [],
        questions: [],
      });

      try {
        await service.updateTeacherPack('teacher-1', 'admin-pack-school-2', {
          title: 'Tampered Title',
        });
        fail('Should have thrown HttpException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.FORBIDDEN);
      }
    });

    it('throws 403 Forbidden when teacher tries to get pack from another school', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher); // school_id: 'school-1'

      prisma.gameQuestionPack.findUnique.mockResolvedValue({
        id: 'admin-pack-school-2',
        school_id: 'school-2',
        created_by_id: 'admin-2',
      });

      try {
        await service.getTeacherPack('teacher-1', 'admin-pack-school-2');
        fail('Should have thrown HttpException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.FORBIDDEN);
      }
    });
  });

  describe('draft delete removes the row; published delete -> 409', () => {
    it('throws 409 Conflict when deleting a published pack (teacher)', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher);

      prisma.gameQuestionPack.findUnique.mockResolvedValue({
        id: 'pack-published-1',
        school_id: 'school-1',
        status: PublishStatus.PUBLISHED,
      });

      try {
        await service.deleteTeacherPack('teacher-1', 'pack-published-1');
        fail('Should have thrown HttpException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
        expect(err.message).toContain('D50');
      }
    });

    it('throws 409 Conflict when deleting a published pack (admin)', async () => {
      prisma.user.findFirst.mockResolvedValue(mockAdmin);

      prisma.gameQuestionPack.findUnique.mockResolvedValue({
        id: 'pack-published-admin',
        school_id: 'school-1',
        status: PublishStatus.PUBLISHED,
      });

      try {
        await service.deleteAdminPack('admin-1', 'pack-published-admin');
        fail('Should have thrown HttpException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
      }
    });

    it('removes pack and related questions/stories when deleting draft pack (teacher)', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher);

      prisma.gameQuestionPack.findUnique.mockResolvedValue({
        id: 'pack-draft-1',
        school_id: 'school-1',
        status: PublishStatus.DRAFT,
      });
      prisma.gameQuestionPack.delete.mockResolvedValue({ id: 'pack-draft-1' });

      const result = await service.deleteTeacherPack(
        'teacher-1',
        'pack-draft-1',
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Game pack deleted');
      expect(prisma.gamePackQuestion.deleteMany).toHaveBeenCalledWith({
        where: { pack_id: 'pack-draft-1' },
      });
      expect(prisma.gamePackStory.deleteMany).toHaveBeenCalledWith({
        where: { pack_id: 'pack-draft-1' },
      });
      expect(prisma.gameQuestionPack.delete).toHaveBeenCalledWith({
        where: { id: 'pack-draft-1' },
      });
    });

    it('removes pack and related questions/stories when deleting draft pack (admin)', async () => {
      prisma.user.findFirst.mockResolvedValue(mockAdmin);

      prisma.gameQuestionPack.findUnique.mockResolvedValue({
        id: 'pack-draft-admin',
        school_id: 'school-1',
        status: PublishStatus.DRAFT,
      });
      prisma.gameQuestionPack.delete.mockResolvedValue({
        id: 'pack-draft-admin',
      });

      const result = await service.deleteAdminPack(
        'admin-1',
        'pack-draft-admin',
      );

      expect(result.success).toBe(true);
      expect(prisma.gameQuestionPack.delete).toHaveBeenCalledWith({
        where: { id: 'pack-draft-admin' },
      });
    });
  });

  describe('options_json is stored and GET returns it to the teacher/admin', () => {
    it('stores options_json during creation and returns it via teacher GET', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher);

      const optionsPayload = {
        options: ['Choice 1', 'Choice 2', 'Choice 3'],
        correctIndex: 2,
      };

      const packData = {
        id: 'pack-with-options',
        school_id: 'school-1',
        title: 'Pack with Options JSON',
        status: PublishStatus.DRAFT,
        age_group: AgeGroup.AGE_6_9,
        created_by_id: 'teacher-1',
        created_at: new Date(),
        updated_at: new Date(),
        stories: [],
        questions: [
          {
            id: 'q-opt-1',
            pack_id: 'pack-with-options',
            round_type: RoundType.Q1_WARMUP,
            sort_order: 1,
            type: QuestionType.MCQ,
            prompt: 'Which choice is correct?',
            options_json: optionsPayload,
            meta_json: { hint: 'Think about kindness' },
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      };

      prisma.gameQuestionPack.create.mockResolvedValue({
        id: 'pack-with-options',
      });
      prisma.gameQuestionPack.findUnique.mockResolvedValue(packData);

      await service.createTeacherPack('teacher-1', {
        title: 'Pack with Options JSON',
        questions: [
          {
            roundType: 'Q1',
            prompt: 'Which choice is correct?',
            options_json: optionsPayload,
            meta_json: { hint: 'Think about kindness' },
          },
        ],
      });

      expect(prisma.gamePackQuestion.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            round_type: RoundType.Q1_WARMUP,
            options_json: optionsPayload,
            meta_json: { hint: 'Think about kindness' },
          }),
        ]),
      });

      // Now call GET
      const getResult = await service.getTeacherPack(
        'teacher-1',
        'pack-with-options',
      );

      expect(getResult.success).toBe(true);
      expect(getResult.data.questions[0].options_json).toEqual(optionsPayload);
      expect(getResult.data.questions[0].optionsJson).toEqual(optionsPayload);
      expect(getResult.data.questions[0].meta_json).toEqual({
        hint: 'Think about kindness',
      });
    });

    it('returns stored options_json via admin GET', async () => {
      prisma.user.findFirst.mockResolvedValue(mockAdmin);

      const optionsPayload = {
        options: ['Yes', 'No'],
        correctIndex: 0,
      };

      const packData = {
        id: 'pack-admin-options',
        school_id: 'school-1',
        title: 'Admin Pack Options',
        status: PublishStatus.DRAFT,
        age_group: AgeGroup.AGE_10_13,
        created_by_id: 'admin-1',
        created_at: new Date(),
        updated_at: new Date(),
        stories: [],
        questions: [
          {
            id: 'q-admin-1',
            pack_id: 'pack-admin-options',
            round_type: RoundType.Q2_DEFENSE,
            sort_order: 1,
            type: QuestionType.MCQ,
            prompt: 'Is this true?',
            options_json: optionsPayload,
            meta_json: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      };

      prisma.gameQuestionPack.findUnique.mockResolvedValue(packData);

      const getResult = await service.getAdminPack(
        'admin-1',
        'pack-admin-options',
      );

      expect(getResult.success).toBe(true);
      expect(getResult.data.questions[0].options_json).toEqual(optionsPayload);
      expect(getResult.data.questions[0].optionsJson).toEqual(optionsPayload);
    });
  });

  describe('Admin and Teacher pack listing and permissions', () => {
    it('lists teacher packs scoped to teacher school', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher);
      prisma.gameQuestionPack.count.mockResolvedValue(1);
      prisma.gameQuestionPack.findMany.mockResolvedValue([
        {
          id: 'pack-1',
          school_id: 'school-1',
          title: 'Kindness Pack',
          status: PublishStatus.PUBLISHED,
          age_group: AgeGroup.AGE_6_9,
          stories: [],
          questions: [],
        },
      ]);

      const res = await service.listTeacherPacks('teacher-1', {
        page: 1,
        perPage: 10,
        status: PublishStatus.PUBLISHED,
      });

      expect(res.success).toBe(true);
      expect(res.data.items.length).toBe(1);
      expect(prisma.gameQuestionPack.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            school_id: 'school-1',
            status: PublishStatus.PUBLISHED,
          }),
        }),
      );
    });

    it('admin without school_id can create pack by passing schoolId', async () => {
      prisma.user.findFirst.mockResolvedValue(mockAdminNoSchool);
      prisma.gameQuestionPack.create.mockResolvedValue({ id: 'pack-super-1' });
      prisma.gameQuestionPack.findUnique.mockResolvedValue({
        id: 'pack-super-1',
        school_id: 'target-school-99',
        title: 'Super Pack',
        status: PublishStatus.DRAFT,
        age_group: AgeGroup.AGE_6_9,
        stories: [],
        questions: [],
      });

      const res = await service.createAdminPack('admin-super', {
        title: 'Super Pack',
        schoolId: 'target-school-99',
      });

      expect(res.success).toBe(true);
      expect(res.data.school_id).toBe('target-school-99');
    });

    it('admin with school_id cannot access pack in another school', async () => {
      prisma.user.findFirst.mockResolvedValue(mockAdmin); // school_id: 'school-1'
      prisma.gameQuestionPack.findUnique.mockResolvedValue({
        id: 'pack-other',
        school_id: 'school-other',
      });

      await expect(
        service.getAdminPack('admin-1', 'pack-other'),
      ).rejects.toThrow(HttpException);
    });
  });
});
